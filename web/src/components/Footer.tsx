import { useReviewStore } from "../reviewStore";
import { COMMENT_DISPATCH_STATUS } from "../types";

type FooterProps = {
  exportText: string;
};

export function Footer({ exportText }: FooterProps) {
  const {
    state: { data },
    actions,
  } = useReviewStore();
  const currentAgent = data?.selected_agent ?? "none";
  const batchedCommentCount =
    data?.hunks.reduce(
      (sum, hunk) =>
        sum +
        hunk.comment_dispatches.filter(
          (dispatch) => dispatch.status === COMMENT_DISPATCH_STATUS.batched,
        ).length,
      0,
    ) ?? 0;

  return (
    <section className="panel panel-plain">
      <div className="toolbar" style={{ justifyContent: "space-between" }}>
        <h2>Review</h2>
      </div>
      {batchedCommentCount > 0 ? (
        <div className="comment-batch-panel">
          <div>
            <strong>Review batch</strong>
            <div className="meta">
              {batchedCommentCount} comment{batchedCommentCount === 1 ? "" : "s"} waiting for{" "}
              {currentAgent === "none" ? "an agent" : currentAgent}
            </div>
          </div>
          <button
            type="button"
            className="secondary"
            disabled={currentAgent === "none"}
            onClick={() => void actions.sendCommentBatch()}
          >
            Send Batch
          </button>
        </div>
      ) : null}
      <textarea className="review-summary-output" readOnly spellCheck={false} value={exportText} />
    </section>
  );
}
