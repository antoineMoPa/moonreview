import { useMemo } from "react";
import { useReviewStore } from "../reviewStore";
import { COMMENT_DISPATCH_STATUS } from "../types";
import type { CommentDispatchStatus, FileChangeKind, SessionState, SidebarComment } from "../types";
import { EMPTY_LINE_DIFF_STATS, lineDiffReducer } from "./diffStats";
import { SidebarCommentsSection } from "./SidebarCommentsSection";
import { SidebarFilesSection } from "./SidebarFilesSection";

export const FILE_STAGE_STATUS = {
  staged: "staged",
  unstaged: "unstaged",
  partial: "partial",
} as const;

export type FileStageStatus = (typeof FILE_STAGE_STATUS)[keyof typeof FILE_STAGE_STATUS];

export type SidebarFileItem = {
  filePath: string;
  fileName: string;
  changeKind: FileChangeKind;
  snoozed: boolean;
  status: FileStageStatus;
  added_line_count: number;
  removed_line_count: number;
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
  snoozedFiles: Set<string>;
  onJumpToFile: (filePath: string) => void;
  onJumpToComment: (target: { filePath: string; hunkId: string; elementId: string }) => void;
  activeFilePath?: string | null;
  onStageWholeFile?: (file: SidebarFileItem) => void;
};

function fileNameFromPath(filePath: string) {
  const segments = filePath.split("/");
  return segments[segments.length - 1] || filePath;
}

function mergeFileChangeKind(left: FileChangeKind, right: FileChangeKind): FileChangeKind {
  return left === right ? left : "modified";
}

function buildSidebarFiles(data: SessionState, snoozedFiles: Set<string>): SidebarFileItem[] {
  const grouped = new Map<string, SidebarFileItem>();
  for (const hunk of data.hunks) {
    const existing = grouped.get(hunk.file_path);
    if (existing) {
      existing.changeKind = mergeFileChangeKind(existing.changeKind, hunk.change_kind);
      existing.added_line_count += hunk.added_line_count;
      existing.removed_line_count += hunk.removed_line_count;
      if (
        (existing.status === FILE_STAGE_STATUS.staged && !hunk.staged) ||
        (existing.status === FILE_STAGE_STATUS.unstaged && hunk.staged)
      ) {
        existing.status = FILE_STAGE_STATUS.partial;
      }
      continue;
    }
    grouped.set(hunk.file_path, {
      filePath: hunk.file_path,
      fileName: fileNameFromPath(hunk.file_path),
      changeKind: hunk.change_kind,
      snoozed: snoozedFiles.has(hunk.file_path),
      status: hunk.staged ? FILE_STAGE_STATUS.staged : FILE_STAGE_STATUS.unstaged,
      added_line_count: hunk.added_line_count,
      removed_line_count: hunk.removed_line_count,
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
  snoozedFiles,
  onJumpToFile,
  onJumpToComment,
  activeFilePath,
  onStageWholeFile,
}: LeftSidebarProps) {
  const {
    state: { busy },
    actions,
  } = useReviewStore();
  const sidebarFiles = useMemo(() => buildSidebarFiles(data, snoozedFiles), [data, snoozedFiles]);
  const sidebarComments = useMemo(() => buildSidebarComments(data), [data]);
  const diffStats = useMemo(
    () => data.hunks.reduce(lineDiffReducer, EMPTY_LINE_DIFF_STATS),
    [data],
  );

  return (
    <aside className="left-sidebar">
      <SidebarSummary commentCount={sidebarComments.length} fileCount={sidebarFiles.length} />
      <SidebarFilesSection
        files={sidebarFiles}
        addedCount={diffStats.added}
        removedCount={diffStats.removed}
        activeFilePath={activeFilePath}
        readOnly={data.read_only}
        busy={busy}
        onJumpToFile={onJumpToFile}
        onToggleFileStage={(file) => {
          const shouldUnstage = file.status === FILE_STAGE_STATUS.staged;
          if (!shouldUnstage) {
            onStageWholeFile?.(file);
          }
          void actions.toggleStageFile(file.filePath, shouldUnstage);
        }}
      />
      <SidebarCommentsSection comments={sidebarComments} onJumpToComment={onJumpToComment} />
    </aside>
  );
}
