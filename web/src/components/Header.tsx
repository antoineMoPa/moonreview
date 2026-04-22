type HeaderProps = {
  repoName?: string | null;
  branchName?: string | null;
};

function formatRepoLabel(repoName?: string | null, branchName?: string | null): string | null {
  if (!repoName) {
    return null;
  }

  return branchName ? `${repoName} / ${branchName}` : repoName;
}

export function Header({ repoName, branchName }: HeaderProps) {
  const repoLabel = formatRepoLabel(repoName, branchName);

  return (
    <header>
      <div className="header-inner">
        <div>
          <h1>🌚 moonreview</h1>
        </div>
        {repoLabel ? <div className="header-repo-name">{repoLabel}</div> : null}
      </div>
    </header>
  );
}
