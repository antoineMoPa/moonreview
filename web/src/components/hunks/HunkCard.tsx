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
import type { Hunk } from "../../types";
import { splitDiffIntoSegments } from "./diffSegments";
import { LineActions } from "./LineActions";
import { SelectionComposer } from "./SelectionComposer";

hljs.registerLanguage("diff", diff);

type HunkCardProps = {
  hunk: Hunk;
};

function HighlightedCode({
  text,
  truncated,
  onSelection,
}: {
  text: string;
  truncated: boolean;
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
      onMouseUp={(event) => onSelection(event.currentTarget)}
      onKeyUp={(event) => onSelection(event.currentTarget)}
    >
      <code ref={codeRef} className="language-diff">
        {text}
      </code>
    </pre>
  );
}

export function HunkCard({ hunk }: HunkCardProps) {
  const { actions } = useReviewStore();
  const hunkRef = useRef<HTMLElement | null>(null);
  const composerOpenRef = useRef(false);
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
    function handleSelectionChange() {
      if (composerOpenRef.current) {
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

      const anchorInside = selection.anchorNode && root.contains(selection.anchorNode);
      const focusInside = selection.focusNode && root.contains(selection.focusNode);
      if (!anchorInside || !focusInside) {
        clearSelectionUi();
      }
    }

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, []);

  const isLong = hunk.patch_line_count > 100;
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

  function captureSelection(container: HTMLPreElement) {
    if (composerOpenRef.current) {
      return;
    }

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      return;
    }

    const text = selection.toString().trim();
    if (!text) {
      return;
    }

    if (!container.contains(selection.anchorNode) || !container.contains(selection.focusNode)) {
      return;
    }

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setSelectedText(text);
    setComposerOpen(false);
    setSelectionPosition({
      top: rect.bottom + window.scrollY + 8,
      left: Math.min(rect.left + window.scrollX, window.scrollX + window.innerWidth - 280),
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

  function addAnchoredComment() {
    const activeSelectedText = composerOpen ? lockedSelectedText : selectedText;
    if (!activeSelectedText.trim() || !selectionNote.trim()) {
      return;
    }

    const next = buildAnchoredCommentValue([
      { selection: activeSelectedText, comment: selectionNote },
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
    <article className="panel hunk" ref={hunkRef}>
      <div className="hunk-actions">
        <button onClick={() => void actions.toggleStage(hunk.id, hunk.staged)}>
          {hunk.staged ? "Unstage Hunk" : "Stage Hunk"}
        </button>
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
          onStageLines={() => {
            void actions.stageSelection(hunk.id, selectedText);
            clearSelectionUi();
          }}
        />
      ) : null}

      {lockedSelectedText && composerOpen && lockedSelectionPosition ? (
        <SelectionComposer
          selectedText={lockedSelectedText}
          note={selectionNote}
          onNoteChange={setSelectionNote}
          onAdd={addAnchoredComment}
          onClear={clearSelectionUi}
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
                onSelection={captureSelection}
              />
            ) : (
              <div className="inline-comment-card" key={`comment-${index}`}>
                <div className="inline-comment-head">
                  <div className="inline-comment-label">Comment</div>
                  <div className="toolbar">
                    {editingCommentIndex === segment.index ? (
                      <button onClick={() => saveEditedComment(segment.index)}>Save</button>
                    ) : (
                      <button onClick={() => startEditingComment(segment.index)}>Edit</button>
                    )}
                    <button onClick={() => deleteComment(segment.index)}>Delete</button>
                  </div>
                </div>
                <pre className="selection-preview">{segment.selection}</pre>
                {editingCommentIndex === segment.index ? (
                  <textarea
                    value={editingCommentValue}
                    onChange={(event) => setEditingCommentValue(event.target.value)}
                    spellCheck={false}
                  />
                ) : (
                  <div className="inline-comment-body">{segment.comment}</div>
                )}
              </div>
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
