import { useMemo } from "react";
import { COMMENT_DISPATCH_STATUS } from "../types";
import type { CommentDispatchStatus, SessionState, SidebarComment } from "../types";
import { SidebarCommentsSection } from "./SidebarCommentsSection";
import { SidebarFilesSection } from "./SidebarFilesSection";

export type SidebarFileItem = {
  filePath: string;
  fileName: string;
  staged: boolean;
};

export type SidebarCommentItem = {
  id: string;
  hunkId: string;
  commentAnchorId: string | null;
  filePath: string;
  comment: string;
  selection: string;
  resolved: boolean;
  statusLabel: string;
};

type LeftSidebarProps = {
  data: SessionState;
  onJumpToFile: (filePath: string) => void;
  onJumpToComment: (target: { filePath: string; hunkId: string; elementId: string }) => void;
};

function fileNameFromPath(filePath: string) {
  const segments = filePath.split("/");
  return segments[segments.length - 1] || filePath;
}

function buildSidebarFiles(data: SessionState): SidebarFileItem[] {
  const grouped = new Map<string, SidebarFileItem>();
  for (const hunk of data.hunks) {
    const existing = grouped.get(hunk.file_path);
    if (existing) {
      continue;
    }
    grouped.set(hunk.file_path, {
      filePath: hunk.file_path,
      fileName: fileNameFromPath(hunk.file_path),
      staged: hunk.staged,
    });
  }

  return [...grouped.values()];
}

function statusLabel(resolved: boolean, status: CommentDispatchStatus) {
  if (status === COMMENT_DISPATCH_STATUS.completed) {
    return "complete";
  }
  if (status === COMMENT_DISPATCH_STATUS.failed) {
    return "failed";
  }
  if (status === COMMENT_DISPATCH_STATUS.running) {
    return "running";
  }
  if (status === COMMENT_DISPATCH_STATUS.queued) {
    return "queued";
  }
  return resolved ? "resolved" : "open";
}

function buildSidebarComments(data: SessionState): SidebarCommentItem[] {
  return data.sidebar_comments.map((comment, index) => buildSidebarCommentItem(comment, index));
}

function buildSidebarCommentItem(comment: SidebarComment, index: number): SidebarCommentItem {
  return {
    id: `${comment.hunk_id}:${comment.comment_index}:${index}`,
    hunkId: comment.hunk_id,
    commentAnchorId: comment.jumpable ? `comment-${comment.hunk_id}-${comment.comment_index}` : null,
    filePath: comment.file_path,
    comment: comment.comment,
    selection: comment.selection,
    resolved: comment.resolved,
    statusLabel: statusLabel(comment.resolved, comment.dispatch_status),
  };
}

type SidebarSummaryProps = {
  commentCount: number;
  fileCount: number;
};

function SidebarSummary({ commentCount, fileCount }: SidebarSummaryProps) {
  return (
    <div className="left-sidebar-head">
      <p className="sidebar-eyebrow meta">
        {commentCount} comments across {fileCount} files
      </p>
    </div>
  );
}

export function LeftSidebar({
  data,
  onJumpToFile,
  onJumpToComment,
}: LeftSidebarProps) {
  const sidebarFiles = useMemo(() => buildSidebarFiles(data), [data]);
  const sidebarComments = useMemo(() => buildSidebarComments(data), [data]);

  return (
    <aside className="left-sidebar">
      <SidebarSummary commentCount={sidebarComments.length} fileCount={sidebarFiles.length} />
      <SidebarFilesSection files={sidebarFiles} onJumpToFile={onJumpToFile} />
      <SidebarCommentsSection comments={sidebarComments} onJumpToComment={onJumpToComment} />
    </aside>
  );
}
