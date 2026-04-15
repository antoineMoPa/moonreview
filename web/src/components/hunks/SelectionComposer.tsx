import type { CSSProperties } from "react";
import { AgentSelect } from "../AgentSelect";
import type { AgentKind, AgentOption } from "../../types";

type SelectionComposerProps = {
  selectedText: string;
  note: string;
  agents: AgentOption[];
  selectedAgent: AgentKind;
  onNoteChange: (value: string) => void;
  onAgentChange: (agent: AgentKind) => void;
  onAdd: () => void;
  onClear: () => void;
  style?: CSSProperties;
};

export function SelectionComposer({
  selectedText,
  note,
  agents,
  selectedAgent,
  onNoteChange,
  onAgentChange,
  onAdd,
  onClear,
  style,
}: SelectionComposerProps) {
  return (
    <div
      className={`anchor-composer ${style ? "anchor-composer-floating" : ""}`.trim()}
      style={style}
    >
      <div className="muted">Selected area</div>
      <pre className="selection-preview">{selectedText}</pre>
      <textarea
        value={note}
        placeholder="Comment for this selected area..."
        onChange={(event) => onNoteChange(event.target.value)}
        spellCheck={false}
      />
      <div className="toolbar">
        <AgentSelect
          agents={agents}
          selectedAgent={selectedAgent}
          onAgentChange={onAgentChange}
          className="agent-picker agent-picker-compact"
        />
        <button className="primary" onClick={onAdd}>
          Add Comment
        </button>
        <button onClick={onClear}>Close</button>
      </div>
    </div>
  );
}
