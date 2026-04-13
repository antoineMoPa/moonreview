import { useEffect, useMemo, useRef, useState } from "react";
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

function HighlightedCode({
  text,
  truncated,
  onSelectionStart,
  onSelection,
}: {
  text: string;
  truncated: boolean;
  onSelectionStart: () => void;
  onSelection: (container: HTMLPreElement) => void;
}) {
  const codeRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (codeRef.current) {
      codeRef.current.removeAttribute("data-highlighted");
      codeRef.current.classList.remove("hljs");
      codeRef.current.textContent = text;
      hljs.highlightElement(codeRef.current);
    }
  }, [text]);

  return (
    <pre
      className={truncated ? "code-pre-truncated" : undefined}
      onMouseDown={onSelectionStart}
      onMouseUp={(event) => onSelection(event.currentTarget)}
      onKeyUp={(event) => onSelection(event.currentTarget)}
    >
      <code ref={codeRef} className="language-diff">
        {text}
      </code>
    </pre>
  );
}

export function HunkCard({ hunk, agents, selectedAgent, onAgentChange }: HunkCardProps) {
  const {
    state: { data },
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
  const [selectionNote, setSelectionNote] = useState("");
  const [composerOpen, setComposerOpen] = useState(false);
  const [selectionPosition, setSelectionPosition] = useState<{ top: number; left: number } | null>(null);
  const [lockedSelectedText, setLockedSelectedText] = useState("");
  const [lockedSelectionPosition, setLockedSelectionPosition] = useState<{ top: number; left: number } | null>(null);
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

  const patchPreviewLineLimit = data?.patch_preview_line_limit ?? 100;
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
    setLockedSelectedText("");
    setSelectionNote("");
    setComposerOpen(false);
    setSelectionPosition(null);
    setLockedSelectionPosition(null);
  }

  function closeSelectionComposer() {
    if (selectionNote.trim() && !window.confirm("Discard this comment?")) {
      return;
    }

    clearSelectionUi();
  }

  function addAnchoredComment() {
    const activeSelectedText = composerOpen ? lockedSelectedText : selectedText;
    if (!activeSelectedText.trim() || !selectionNote.trim()) {
      return;
    }

    const next = buildAnchoredCommentValue([
      { selection: activeSelectedText, comment: selectionNote, resolved: false },
      ...parsedComments,
    ]).trim();

    setCommentValue(next);
    actions.updateDraftComment(hunk.id, next);
    setSelectionNote("");
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

  return (
    <article id={`hunk-${hunk.id}`} className="panel hunk" ref={hunkRef}>
      <div className="hunk-actions">
        {!readOnly ? (
          <>
            <button onClick={() => void actions.toggleStage(hunk.id, hunk.staged)}>
              {hunk.staged ? "Unstage Hunk" : "Stage Hunk"}
            </button>
            <button onClick={() => void actions.discardHunk(hunk.id)}>Discard Hunk</button>
          </>
        ) : null}
        {isLong && expanded ? <button onClick={() => void toggleExpanded()}>Collapse Diff</button> : null}
      </div>

      {selectedText && !composerOpen && selectionPosition ? (
        <LineActions
          style={{ top: selectionPosition.top, left: selectionPosition.left }}
          onAddComment={() => {
            composerOpenRef.current = true;
            setLockedSelectedText(selectedText);
            setLockedSelectionPosition(selectionPosition);
            setComposerOpen(true);
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

      {lockedSelectedText && composerOpen && lockedSelectionPosition ? (
        <SelectionComposer
          selectedText={lockedSelectedText}
          note={selectionNote}
          agents={agents}
          selectedAgent={selectedAgent}
          onNoteChange={setSelectionNote}
          onAgentChange={onAgentChange}
          onAdd={addAnchoredComment}
          onClear={closeSelectionComposer}
          style={{ top: lockedSelectionPosition.top + 36, left: lockedSelectionPosition.left }}
        />
      ) : null}

      <div className={`patch-wrap ${!expanded && isLong ? "patch-truncated" : ""}`.trim()}>
        <div className="diff-stack">
          {diffSegments.map((segment, index) =>
            segment.type === "code" ? (
              <HighlightedCode
                key={`code-${index}`}
                text={segment.text}
                truncated={!expanded && isLong && index === diffSegments.length - 1}
                onSelectionStart={() => {
                  selectionStartedInHunkRef.current = true;
                }}
                onSelection={captureSelection}
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
        {isLong && !expanded ? (
          <button className="patch-expand-button" onClick={() => void toggleExpanded()}>
            {loadingPatch ? "Loading Diff..." : `Expand Diff (${hunk.patch_line_count} lines)`}
          </button>
        ) : null}
      </div>
    </article>
  );
}
