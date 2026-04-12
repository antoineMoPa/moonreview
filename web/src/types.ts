export type AgentKind = "none" | "claude" | "codex";

export const COMMENT_DISPATCH_STATUS = {
  idle: "idle",
  queued: "queued",
  running: "running",
  completed: "completed",
  failed: "failed",
} as const;

export type CommentDispatchStatus =
  (typeof COMMENT_DISPATCH_STATUS)[keyof typeof COMMENT_DISPATCH_STATUS];

export type AgentOption = {
  kind: AgentKind;
  label: string;
  available: boolean;
};

export type CommentDispatch = {
  status: CommentDispatchStatus;
  detail: string;
  can_cancel?: boolean;
};

export type Hunk = {
  id: string;
  file_path: string;
  header: string;
  staged: boolean;
  reviewed: boolean;
  comment: string;
  comment_dispatches: CommentDispatch[];
  patch_preview: string;
  patch_line_count: number;
};

export type SessionState = {
  repo_name: string;
  repo_path: string;
  read_only: boolean;
  patch_preview_line_limit: number;
  available_agents: AgentOption[];
  selected_agent: AgentKind;
  hunks: Hunk[];
  export_text: string;
};

export type PatchPayload = {
  patch: string;
};
