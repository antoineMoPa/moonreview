import type { ReactNode } from "react";
import type { SidebarFileItem } from "./LeftSidebar";

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

function SidebarFileButton({ file, active, readOnly, busy, onJumpToFile, onToggleFileStage }: SidebarFileButtonProps) {
  return (
    <div className="sidebar-link" title={file.filePath}>
      <button
        className={`sidebar-link-action ${active ? "sidebar-link-active" : ""}`.trim()}
        type="button"
        onClick={() => onJumpToFile(file.filePath)}
      >
        <span className="sidebar-link-name">{file.fileName}</span>
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
  activeFilePath?: string | null;
  readOnly: boolean;
  busy: boolean;
  onJumpToFile: (filePath: string) => void;
  onToggleFileStage: (file: SidebarFileItem) => void;
};

export function SidebarFilesSection({
  files,
  activeFilePath,
  readOnly,
  busy,
  onJumpToFile,
  onToggleFileStage,
}: SidebarFilesSectionProps) {
  return (
    <SidebarSection title="Files">
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
