import type { ReactNode } from "react";
import type { SidebarFileItem } from "./LeftSidebar";

type SidebarSectionProps = {
  title: string;
  addedCount?: number;
  removedCount?: number;
  children: ReactNode;
};

function SidebarSection({ title, addedCount, removedCount, children }: SidebarSectionProps) {
  return (
    <section className="sidebar-section">
      <div className="sidebar-section-head">
        <p>{title}</p>
        {typeof addedCount === "number" && typeof removedCount === "number" ? (
          <div className="diff-stats-summary" aria-label="Diff stats">
            <span className="diff-stat diff-stat-added">++{addedCount}</span>
            <span className="diff-stat diff-stat-removed">--{removedCount}</span>
          </div>
        ) : null}
      </div>
      <div className="sidebar-list">{children}</div>
    </section>
  );
}

type SidebarFileButtonProps = {
  file: SidebarFileItem;
  active: boolean;
  readOnly: boolean;
  busy: boolean;
  onJumpToFile: (filePath: string) => void;
  onToggleFileStage: (file: SidebarFileItem) => void;
};

function statusLabel(file: SidebarFileItem) {
  if (file.status === "partial") {
    return "Partial";
  }
  return file.status === "staged" ? "Staged" : "Unstaged";
}

function filePrefix(file: SidebarFileItem) {
  if (file.changeKind === "added") {
    return "+";
  }
  if (file.changeKind === "deleted") {
    return "-";
  }
  return "";
}

function SidebarFileButton({ file, active, readOnly, busy, onJumpToFile, onToggleFileStage }: SidebarFileButtonProps) {
  return (
    <div className="sidebar-link" title={file.filePath}>
      <button
        className={`sidebar-link-action ${active ? "sidebar-link-active" : ""}`.trim()}
        type="button"
        onClick={() => onJumpToFile(file.filePath)}
      >
        <span className={`sidebar-link-name sidebar-link-name-${file.changeKind}`.trim()}>
          <span className={`sidebar-link-prefix sidebar-link-prefix-${file.changeKind}`.trim()}>
            {filePrefix(file)}
          </span>
          {file.fileName}
        </span>
      </button>
      <span className="sidebar-link-meta">
        <button
          className={`badge sidebar-file-status sidebar-file-status-${file.status}`.trim()}
          type="button"
          title="toggle file stage"
          disabled={readOnly || busy}
          onClick={(event) => {
            event.stopPropagation();
            onToggleFileStage(file);
          }}
        >
          {statusLabel(file)}
        </button>
      </span>
    </div>
  );
}

type SidebarFilesSectionProps = {
  files: SidebarFileItem[];
  addedCount: number;
  removedCount: number;
  activeFilePath?: string | null;
  readOnly: boolean;
  busy: boolean;
  onJumpToFile: (filePath: string) => void;
  onToggleFileStage: (file: SidebarFileItem) => void;
};

export function SidebarFilesSection({
  files,
  addedCount,
  removedCount,
  activeFilePath,
  readOnly,
  busy,
  onJumpToFile,
  onToggleFileStage,
}: SidebarFilesSectionProps) {
  return (
    <SidebarSection title="Files" addedCount={addedCount} removedCount={removedCount}>
      {files.map((file) => (
        <SidebarFileButton
          key={file.filePath}
          file={file}
          active={file.filePath === activeFilePath}
          readOnly={readOnly}
          busy={busy}
          onJumpToFile={onJumpToFile}
          onToggleFileStage={onToggleFileStage}
        />
      ))}
    </SidebarSection>
  );
}
