type HeaderProps = {
  repoPath: string;
  busy: boolean;
  onCopyExport: () => void;
};

export function Header({ repoPath, busy, onCopyExport }: HeaderProps) {
  return (
    <header>
      <div>
        <h1>🌚 moonreview</h1>
        <div className="meta">{repoPath}</div>
      </div>
      <div className="toolbar">
        <button className="primary" onClick={onCopyExport} disabled={busy}>
          Copy Review
        </button>
      </div>
    </header>
  );
}
