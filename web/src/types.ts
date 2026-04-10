export type Hunk = {
  id: string;
  file_path: string;
  header: string;
  staged: boolean;
  reviewed: boolean;
  comment: string;
  patch_preview: string;
  patch_line_count: number;
};

export type SessionState = {
  repo_name: string;
  repo_path: string;
  read_only: boolean;
  patch_preview_line_limit: number;
  hunks: Hunk[];
  export_text: string;
};

export type PatchPayload = {
  patch: string;
};
