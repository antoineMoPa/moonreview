import type { ReactNode } from "react";
import type { SidebarCommentItem } from "./LeftSidebar";

function fileNameFromPath(filePath: string) {
  const segments = filePath.split("/");
  return segments[segments.length - 1] || filePath;
}

function commentStatusClassName(status: string) {
  return `sidebar-status sidebar-status-${status}`;
}

function truncateLine(value: string, maxLength: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLength) {
    return compact;
  }
  return `${compact.slice(0, maxLength - 1)}...`;
}

type SidebarSectionProps = {
  title: string;
  children: ReactNode;
};

function SidebarSection({ title, children }: SidebarSectionProps) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-section-head">
        <p>{title}</p>
      </div>
      <div className="sidebar-list">{children}</div>
    </section>
  );
}

type SidebarCommentButtonProps = {
  comment: SidebarCommentItem;
  onJumpToComment: (target: { filePath: string; hunkId: string; elementId: string }) => void;
};

function SidebarCommentButton({ comment, onJumpToComment }: SidebarCommentButtonProps) {
  return (
    <button
      className="sidebar-comment-link"
      disabled={!comment.commentAnchorId}
      onClick={() =>
        comment.commentAnchorId
          ? onJumpToComment({
              filePath: comment.filePath,
              hunkId: comment.hunkId,
              elementId: comment.commentAnchorId,
            })
          : undefined
      }
      title={comment.filePath}
    >
      <div className="sidebar-comment-topline">
        <span className={commentStatusClassName(comment.statusLabel)}>{comment.statusLabel}</span>
        <span className="muted sidebar-comment-file">{fileNameFromPath(comment.filePath)}</span>
      </div>
      <p>{truncateLine(comment.comment, 72)}</p>
      <span className="muted">{truncateLine(comment.selection, 72)}</span>
    </button>
  );
}

type SidebarCommentsSectionProps = {
  comments: SidebarCommentItem[];
  onJumpToComment: (target: { filePath: string; hunkId: string; elementId: string }) => void;
};

export function SidebarCommentsSection({ comments, onJumpToComment }: SidebarCommentsSectionProps) {
  return (
    <SidebarSection title="Comments">
      {comments.length > 0 ? (
        comments.map((comment) => <SidebarCommentButton key={comment.id} comment={comment} onJumpToComment={onJumpToComment} />)
      ) : (
        <div className="empty-section muted">No comments yet.</div>
      )}
    </SidebarSection>
  );
}
