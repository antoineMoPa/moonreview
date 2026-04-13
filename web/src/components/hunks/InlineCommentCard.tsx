import type { Dispatch, SetStateAction } from "react";
import { COMMENT_DISPATCH_STATUS } from "../../types";
import type { AgentKind, AgentOption, CommentDispatch } from "../../types";
import type { DiffSegment } from "./diffSegments";
import { AgentSelect } from "../AgentSelect";

type InlineCommentSegment = Extract<DiffSegment, { type: "comment" }>;

type InlineCommentCardProps = {
  id?: string;
  agents: AgentOption[];
  selectedAgent: AgentKind;
  segment: InlineCommentSegment;
  dispatch: CommentDispatch | undefined;
  editing: boolean;
  editingCommentValue: string;
  onAgentChange: (agent: AgentKind) => void;
  onToggleResolved: (index: number) => void;
  onStartEditing: (index: number) => void;
  onSave: (index: number) => void;
  onDelete: (index: number) => void;
  onEditingCommentValueChange: Dispatch<SetStateAction<string>>;
};

const HIDDEN_DISPATCH_STATUS = COMMENT_DISPATCH_STATUS.idle;

export function InlineCommentCard({
  id,
  agents,
  selectedAgent,
  segment,
  dispatch,
  editing,
  editingCommentValue,
  onAgentChange,
  onToggleResolved,
  onStartEditing,
  onSave,
  onDelete,
  onEditingCommentValueChange,
}: InlineCommentCardProps) {
  const resolvedClassName = segment.resolved ? "resolved" : "";
  const showDispatch = dispatch && dispatch.status !== HIDDEN_DISPATCH_STATUS;

  return (
    <div id={id} className="inline-comment-card">
      <div className="inline-comment-head">
        <div className={`inline-comment-label ${resolvedClassName}`.trim()}>
          {segment.resolved ? "Resolved" : "Comment"}
        </div>
        <div className="toolbar">
          <button onClick={() => onToggleResolved(segment.index)}>
            {segment.resolved ? "Reopen" : "Resolve"}
          </button>
          {editing ? (
            <button onClick={() => onSave(segment.index)}>Save</button>
          ) : (
            <button onClick={() => onStartEditing(segment.index)}>Edit</button>
          )}
          <button onClick={() => onDelete(segment.index)}>Delete</button>
        </div>
      </div>
      {showDispatch ? (
        <div className={`dispatch-status dispatch-status-${dispatch.status}`.trim()}>
          <strong>{dispatch.status}</strong>
          {dispatch.detail ? <span>{dispatch.detail}</span> : null}
        </div>
      ) : null}
      <pre className="selection-preview">{segment.selection}</pre>
      {editing ? (
        <>
          <AgentSelect
            agents={agents}
            selectedAgent={selectedAgent}
            onAgentChange={onAgentChange}
            className="agent-picker agent-picker-inline"
          />
          <textarea
            value={editingCommentValue}
            onChange={(event) => onEditingCommentValueChange(event.target.value)}
            spellCheck={false}
          />
        </>
      ) : (
        <div className={`inline-comment-body ${resolvedClassName}`.trim()}>{segment.comment}</div>
      )}
    </div>
  );
}
