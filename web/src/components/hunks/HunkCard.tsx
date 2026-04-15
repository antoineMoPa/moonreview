import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import hljs from "highlight.js/lib/core";
import diff from "highlight.js/lib/languages/diff";
import { fetchHunkPatch } from "../../api";
import {
  buildAnchoredCommentValue,
  parseAnchoredComments,
  type AnchoredComment,
} from "../../anchoredComments";
import { useReviewStore } from "../../reviewStore";
import type { AgentKind, AgentOption, Hunk } from "../../types";
import { splitDiffIntoSegments } from "./diffSegments";
import { InlineCommentCard } from "./InlineCommentCard";
import { LineActions } from "./LineActions";
import { SelectionComposer } from "./SelectionComposer";

hljs.registerLanguage("diff", diff);

type HunkCardProps = {
  hunk: Hunk;
  agents: AgentOption[];
  selectedAgent: AgentKind;
  onAgentChange: (agent: AgentKind) => void;
};

function selectionLivesWithin(container: Node, selection: Selection): boolean {
  if (selection.rangeCount === 0) {
    return false;
  }

  return container.contains(selection.getRangeAt(0).commonAncestorContainer);
}

function readSelection(container: Node): Selection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return null;
  }

  return selectionLivesWithin(container, selection) ? selection : null;
}

function selectionPositionFromRect(rect: DOMRect) {
  return {
    top: rect.bottom + window.scrollY + 8,
    left: Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - 280),
  };
}

type FloatingPosition = {
  top: number;
  left: number;
};

type DiffLine = {
  text: string;
  newLineNumber: number | null;
  commentable: boolean;
  highlightedHtml: string;
};

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if (!match) {
    return null;
  }

  return {
    oldStart: Number.parseInt(match[1], 10),
    newStart: Number.parseInt(match[2], 10),
  };
}

function buildDiffLines(text: string): DiffLine[] {
  let oldLineNumber: number | null = null;
  let newLineNumber: number | null = null;

  return text.split("\n").map((line) => {
    let next: DiffLine;

    if (line.startsWith("@@")) {
      const parsed = parseHunkHeader(line);
      oldLineNumber = parsed?.oldStart ?? null;
      newLineNumber = parsed?.newStart ?? null;
      next = {
        text: line,
        newLineNumber: null,
        commentable: false,
        highlightedHtml: hljs.highlight(line, { language: "diff" }).value,
      };
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      next = {
        text: line,
        newLineNumber,
        commentable: true,
        highlightedHtml: hljs.highlight(line, { language: "diff" }).value,
      };
      newLineNumber = newLineNumber === null ? null : newLineNumber + 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      next = {
        text: line,
        newLineNumber: null,
        commentable: true,
        highlightedHtml: hljs.highlight(line, { language: "diff" }).value,
      };
      oldLineNumber = oldLineNumber === null ? null : oldLineNumber + 1;
    } else if (line.startsWith(" ")) {
      next = {
        text: line,
        newLineNumber,
        commentable: true,
        highlightedHtml: hljs.highlight(line, { language: "diff" }).value,
      };
      oldLineNumber = oldLineNumber === null ? null : oldLineNumber + 1;
      newLineNumber = newLineNumber === null ? null : newLineNumber + 1;
    } else {
      next = {
        text: line,
        newLineNumber: null,
        commentable: false,
        highlightedHtml: hljs.highlight(line, { language: "diff" }).value,
      };
    }

    return next;
  });
}

function HighlightedCode({
  text,
  onSelectionStart,
  onSelection,
  onLineNumberClick,
}: {
  text: string;
  onSelectionStart: () => void;
  onSelection: (container: HTMLDivElement) => void;
  onLineNumberClick: (line: string, rect: DOMRect) => void;
}) {
  const lines = useMemo(() => buildDiffLines(text), [text]);
  const gutterChars = useMemo(() => {
    const maxLineNumber = lines.reduce(
      (max, line) => (line.newLineNumber !== null ? Math.max(max, line.newLineNumber) : max),
      0,
    );
    return Math.max(String(maxLineNumber || 0).length, 2);
  }, [lines]);

  return (
    <div
      className="diff-code"
      style={{ "--diff-gutter-ch": gutterChars } as CSSProperties}
      onMouseDown={onSelectionStart}
      onMouseUp={(event) => onSelection(event.currentTarget)}
      onKeyUp={(event) => onSelection(event.currentTarget)}
    >
      {lines.map((line, index) => (
        <div key={`${index}:${line.text}`} className="diff-line">
          <button
            type="button"
            className={`diff-gutter-button ${line.commentable && line.newLineNumber !== null ? "diff-gutter-button-active" : ""}`.trim()}
            onClick={(event) => {
              if (line.commentable && line.newLineNumber !== null) {
                onLineNumberClick(line.text, event.currentTarget.getBoundingClientRect());
              }
            }}
            aria-label={
              line.newLineNumber !== null
                ? `Add comment on new line ${line.newLineNumber}`
                : "No line number"
            }
          >
            {line.newLineNumber ?? ""}
          </button>
          <div
            className="diff-line-code"
            dangerouslySetInnerHTML={{ __html: line.highlightedHtml || "&nbsp;" }}
          />
        </div>
      ))}
    </div>
  );
}

export function HunkCard({ hunk, agents, selectedAgent, onAgentChange }: HunkCardProps) {
  const {
    state: { data, selectionDraft },
    actions,
  } = useReviewStore();
  const hunkRef = useRef<HTMLElement | null>(null);
  const composerOpenRef = useRef(false);
  const selectionStartedInHunkRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [fullPatch, setFullPatch] = useState<string | null>(null);
  const [loadingPatch, setLoadingPatch] = useState(false);
  const [commentValue, setCommentValue] = useState(hunk.comment);
  const [selectedText, setSelectedText] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectionPosition, setSelectionPosition] = useState<{ top: number; left: number } | null>(null);
  const [lockedSelectedText, setLockedSelectedText] = useState("");
  const [lockedSelectionPosition, setLockedSelectionPosition] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [editingCommentIndex, setEditingCommentIndex] = useState<number | null>(null);
  const [editingCommentValue, setEditingCommentValue] = useState("");

  useEffect(() => {
    setCommentValue(hunk.comment);
  }, [hunk.comment]);

  useEffect(() => {
    composerOpenRef.current = composerOpen;
  }, [composerOpen]);

  useEffect(() => {
    function finalizeSelectionFromRoot() {
      if (composerOpenRef.current) {
        return;
      }

      if (!selectionStartedInHunkRef.current) {
        return;
      }

      const root = hunkRef.current;
      if (!root) {
        selectionStartedInHunkRef.current = false;
        return;
      }

      captureSelection(root);
      selectionStartedInHunkRef.current = false;
    }

    function handleSelectionChange() {
      if (composerOpenRef.current) {
        return;
      }

      if (selectionStartedInHunkRef.current) {
        return;
      }

      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        clearSelectionUi();
        return;
      }

      const root = hunkRef.current;
      if (!root) {
        clearSelectionUi();
        return;
      }

      if (!selectionLivesWithin(root, selection)) {
        clearSelectionUi();
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    window.addEventListener("mouseup", finalizeSelectionFromRoot);
    window.addEventListener("keyup", finalizeSelectionFromRoot);
    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
      window.removeEventListener("mouseup", finalizeSelectionFromRoot);
      window.removeEventListener("keyup", finalizeSelectionFromRoot);
    };
  }, []);

  const patchPreviewLineLimit = data?.patch_preview_line_limit ?? 500;
  const isLong = hunk.patch_line_count > patchPreviewLineLimit;
  const visiblePatch = useMemo(() => {
    if (expanded && fullPatch) {
      return fullPatch;
    }
    return hunk.patch_preview;
  }, [expanded, fullPatch, hunk.patch_preview]);

  const parsedComments = useMemo(() => parseAnchoredComments(commentValue), [commentValue]);
  const diffSegments = useMemo(
    () => splitDiffIntoSegments(visiblePatch, parsedComments),
    [visiblePatch, parsedComments],
  );
  const readOnly = data?.read_only ?? false;
  const attachedDraft = selectionDraft?.hunkId === hunk.id ? selectionDraft : null;

  function openSelectionDraft(selection: string, anchorPosition?: FloatingPosition) {
    const nextSelection = selection.trim();
    if (!nextSelection) {
      return;
    }

    if (
      attachedDraft &&
      attachedDraft.note.trim() &&
      attachedDraft.selectedText !== nextSelection &&
      !window.confirm("Replace this in-progress comment draft?")
    ) {
      return;
    }

    actions.setSelectionDraft({
      hunkId: hunk.id,
      filePath: hunk.file_path,
      header: hunk.header,
      selectedText: nextSelection,
      note: attachedDraft?.selectedText === nextSelection ? attachedDraft.note : "",
    });
    if (anchorPosition) {
      setLockedSelectedText(nextSelection);
      setLockedSelectionPosition(anchorPosition);
    }
    setComposerOpen(true);
  }

  function captureSelection(container: Node) {
    if (composerOpenRef.current) {
      return;
    }

    window.requestAnimationFrame(() => {
      const selection = readSelection(container);
      if (!selection) {
        return;
      }

      const text = selection.toString().trim();
      if (!text) {
        return;
      }

      const rect = selection.getRangeAt(0).getBoundingClientRect();
      setSelectedText(text);
      setComposerOpen(false);
      setSelectionPosition(selectionPositionFromRect(rect));
    });
  }

  function clearSelectionUi() {
    composerOpenRef.current = false;
    setSelectedText("");
    setComposerOpen(false);
    setSelectionPosition(null);
    setLockedSelectedText("");
    setLockedSelectionPosition(null);
  }

  function closeSelectionComposer() {
    if (attachedDraft?.note.trim() && !window.confirm("Discard this comment?")) {
      return;
    }

    actions.clearSelectionDraft();
    clearSelectionUi();
  }

  function addAnchoredComment() {
    const activeSelectedText = attachedDraft?.selectedText ?? lockedSelectedText ?? selectedText;
    const note = attachedDraft?.note ?? "";
    if (!activeSelectedText.trim() || !note.trim()) {
      return;
    }

    const next = buildAnchoredCommentValue([
      { selection: activeSelectedText, comment: note, resolved: false },
      ...parsedComments,
    ]).trim();

    setCommentValue(next);
    actions.updateDraftComment(hunk.id, next);
    actions.clearSelectionDraft();
    setSelectedText("");
    setComposerOpen(false);
    void actions.saveComment(hunk.id, next);
  }

  function persistAnchoredComments(nextAnchored: AnchoredComment[]) {
    const next = buildAnchoredCommentValue(nextAnchored).trim();
    setCommentValue(next);
    actions.updateDraftComment(hunk.id, next);
    void actions.saveComment(hunk.id, next);
  }

  function startEditingComment(index: number) {
    setEditingCommentIndex(index);
    setEditingCommentValue(parsedComments[index]?.comment ?? "");
  }

  function saveEditedComment(index: number) {
    const nextAnchored = parsedComments.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, comment: editingCommentValue } : entry,
    );
    persistAnchoredComments(nextAnchored);
    setEditingCommentIndex(null);
    setEditingCommentValue("");
  }

  function deleteComment(index: number) {
    const nextAnchored = parsedComments.filter((_, entryIndex) => entryIndex !== index);
    persistAnchoredComments(nextAnchored);
    setEditingCommentIndex(null);
    setEditingCommentValue("");
  }

  function toggleCommentResolved(index: number) {
    const nextAnchored = parsedComments.map((entry, entryIndex) =>
      entryIndex === index ? { ...entry, resolved: !entry.resolved } : entry,
    );
    persistAnchoredComments(nextAnchored);
  }

  async function toggleExpanded() {
    if (expanded) {
      setExpanded(false);
      return;
    }

    if (fullPatch === null) {
      setLoadingPatch(true);
      try {
        const payload = await fetchHunkPatch(hunk.id);
        setFullPatch(payload.patch);
      } finally {
        setLoadingPatch(false);
      }
    }

    setExpanded(true);
  }

  function confirmDiscardHunk() {
    if (!window.confirm("Discard this hunk?")) {
      return;
    }

    void actions.discardHunk(hunk.id);
  }

  return (
    <article id={`hunk-${hunk.id}`} className="panel hunk" ref={hunkRef}>
      <div className="hunk-actions">
        {!readOnly ? (
          <>
            <button onClick={() => void actions.toggleStage(hunk.id, hunk.staged)}>
              {hunk.staged ? "Unstage Hunk" : "Stage Hunk"}
            </button>
            <button onClick={confirmDiscardHunk}>Discard Hunk</button>
          </>
        ) : null}
        {isLong ? (
          <button onClick={() => void toggleExpanded()}>
            {expanded
              ? "Collapse Diff"
              : loadingPatch
                ? "Loading Diff..."
                : `Expand Diff (${hunk.patch_line_count} lines)`}
          </button>
        ) : null}
      </div>

      {selectedText && !composerOpen && selectionPosition ? (
        <LineActions
          style={{ top: selectionPosition.top, left: selectionPosition.left }}
          onAddComment={() => {
            composerOpenRef.current = true;
            setLockedSelectedText(selectedText);
            setLockedSelectionPosition(selectionPosition);
            openSelectionDraft(selectedText, selectionPosition);
          }}
          onStageLines={
            readOnly
              ? undefined
              : () => {
                  void actions.stageSelection(hunk.id, selectedText);
                  clearSelectionUi();
                }
          }
        />
      ) : null}

      {attachedDraft ? (
        <SelectionComposer
          selectedText={attachedDraft.selectedText}
          note={attachedDraft.note}
          agents={agents}
          selectedAgent={selectedAgent}
          onNoteChange={(value) =>
            actions.setSelectionDraft({
              ...attachedDraft,
              note: value,
            })
          }
          onAgentChange={onAgentChange}
          onAdd={addAnchoredComment}
          onClear={closeSelectionComposer}
          style={
            composerOpen && lockedSelectionPosition
              ? { top: lockedSelectionPosition.top + 36, left: lockedSelectionPosition.left }
              : undefined
          }
        />
      ) : null}

      <div className={`patch-wrap ${!expanded && isLong ? "patch-truncated" : ""}`.trim()}>
        <div className="diff-stack">
          {diffSegments.map((segment, index) =>
            segment.type === "code" ? (
              <HighlightedCode
                key={`code-${index}`}
                text={segment.text}
                onSelectionStart={() => {
                  selectionStartedInHunkRef.current = true;
                }}
                onSelection={captureSelection}
                onLineNumberClick={(line, rect) => openSelectionDraft(line, selectionPositionFromRect(rect))}
              />
            ) : (
              <InlineCommentCard
                key={`comment-${index}`}
                id={`comment-${hunk.id}-${segment.index}`}
                agents={agents}
                selectedAgent={selectedAgent}
                segment={segment}
                dispatch={hunk.comment_dispatches[segment.index]}
                editing={editingCommentIndex === segment.index}
                editingCommentValue={editingCommentValue}
                onAgentChange={onAgentChange}
                onToggleResolved={toggleCommentResolved}
                onStartEditing={startEditingComment}
                onSave={saveEditedComment}
                onDelete={deleteComment}
                onEditingCommentValueChange={setEditingCommentValue}
              />
            ),
          )}
        </div>
      </div>
    </article>
  );
}
