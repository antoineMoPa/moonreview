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
  onJumpToFile: (filePath: string) => void;
};

function SidebarFileButton({ file, onJumpToFile }: SidebarFileButtonProps) {
  return (
    <button className="sidebar-link" onClick={() => onJumpToFile(file.filePath)} title={file.filePath}>
      <span className="sidebar-link-name">{file.fileName}</span>
      <span className="sidebar-link-meta">
        <span className={`badge ${file.staged ? "staged" : "unstaged"}`.trim()}>
          {file.staged ? "Staged" : "Unstaged"}
        </span>
      </span>
    </button>
  );
}

type SidebarFilesSectionProps = {
  files: SidebarFileItem[];
  onJumpToFile: (filePath: string) => void;
};

export function SidebarFilesSection({ files, onJumpToFile }: SidebarFilesSectionProps) {
  return (
    <SidebarSection title="Files">
      {files.map((file) => (
        <SidebarFileButton key={file.filePath} file={file} onJumpToFile={onJumpToFile} />
      ))}
    </SidebarSection>
  );
}
