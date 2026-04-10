import type { CSSProperties } from "react";

type SelectionComposerProps = {
  selectedText: string;
  note: string;
  onNoteChange: (value: string) => void;
  onAdd: () => void;
  onClear: () => void;
  style?: CSSProperties;
};

export function SelectionComposer({
  selectedText,
  note,
  onNoteChange,
  onAdd,
  onClear,
  style,
}: SelectionComposerProps) {
  return (
    <div className="anchor-composer anchor-composer-floating" style={style}>
      <div className="muted">Selected area</div>
      <pre className="selection-preview">{selectedText}</pre>
      <textarea
        value={note}
        placeholder="Comment for this selected area..."
        onChange={(event) => onNoteChange(event.target.value)}
        spellCheck={false}
      />
      <div className="toolbar">
        <button className="primary" onClick={onAdd}>
          Add Comment
        </button>
        <button onClick={onClear}>Close</button>
      </div>
    </div>
  );
}
