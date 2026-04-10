import type { CSSProperties } from "react";

type LineActionsProps = {
  onAddComment: () => void;
  onStageLines?: () => void;
  style?: CSSProperties;
};

export function LineActions({ onAddComment, onStageLines, style }: LineActionsProps) {
  return (
    <div className="line-actions" style={style}>
      <button className="primary" onClick={onAddComment}>
        Add Comment
      </button>
      {onStageLines ? <button onClick={onStageLines}>Stage Lines</button> : null}
    </div>
  );
}
