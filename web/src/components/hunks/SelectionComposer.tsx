import { AgentSelect } from "../AgentSelect";
import { useHunkCommentContext, type CSSProperties } from "./HunkCommentContext";

type SelectionComposerProps = {
  draftId: string;
  style?: CSSProperties;
};

export function SelectionComposer({ draftId, style }: SelectionComposerProps) {
  const {
    agents,
    selectedAgent,
    onAgentChange,
    getDraft,
    onDraftNoteChange,
    onDraftAdd,
    onDraftClear,
  } = useHunkCommentContext();
  const draft = getDraft(draftId);
  if (!draft) {
    return null;
  }

  return (
    <div
      className={`anchor-composer ${style ? "anchor-composer-floating" : ""}`.trim()}
      style={style}
    >
      <div className="muted">Selected area</div>
      <pre className="selection-preview">{draft.selectedText}</pre>
      <textarea
        value={draft.note}
        placeholder="Comment for this selected area..."
        onChange={(event) => onDraftNoteChange(draftId, event.target.value)}
        spellCheck={false}
      />
      <div className="toolbar">
        <AgentSelect
          agents={agents}
          selectedAgent={selectedAgent}
          onAgentChange={onAgentChange}
          className="agent-picker agent-picker-compact"
        />
        <button className="primary" onClick={() => onDraftAdd(draftId)}>
          Add Comment
        </button>
        <button onClick={() => onDraftClear(draftId)}>Close</button>
      </div>
    </div>
  );
}
