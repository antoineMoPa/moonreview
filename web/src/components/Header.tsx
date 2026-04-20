type HeaderProps = {
  repoName?: string | null;
};

export function Header({ repoName }: HeaderProps) {
  return (
    <header>
      <div className="header-inner">
        <div>
          <h1>🌚 moonreview</h1>
        </div>
        {repoName ? <div className="header-repo-name">{repoName}</div> : null}
      </div>
    </header>
  );
}
