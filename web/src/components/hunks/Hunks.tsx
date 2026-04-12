import { useEffect, useMemo, useState } from "react";
import { useReviewStore } from "../../reviewStore";
import type { AgentKind, AgentOption, Hunk } from "../../types";
import { HunkCard } from "./HunkCard";

type HunksProps = {
  hunks: Hunk[];
  agents: AgentOption[];
  selectedAgent: AgentKind;
  onAgentChange: (agent: AgentKind) => void;
};

type FileGroup = {
  filePath: string;
  hunks: Hunk[];
};

function groupByFile(hunks: Hunk[]): FileGroup[] {
  const grouped = new Map<string, Hunk[]>();
  for (const hunk of hunks) {
    const existing = grouped.get(hunk.file_path) ?? [];
    existing.push(hunk);
    grouped.set(hunk.file_path, existing);
  }

  return [...grouped.entries()].map(([filePath, fileHunks]) => ({
    filePath,
    hunks: fileHunks,
  }));
}

function FileAccordion({
  filePath,
  hunks,
  agents,
  selectedAgent,
  onAgentChange,
  defaultOpen,
}: {
  filePath: string;
  hunks: Hunk[];
  agents: AgentOption[];
  selectedAgent: AgentKind;
  onAgentChange: (agent: AgentKind) => void;
  defaultOpen: boolean;
}) {
  const {
    state: { data },
    actions,
  } = useReviewStore();
  const [open, setOpen] = useState(defaultOpen);
  const staged = hunks[0]?.staged ?? false;
  const readOnly = data?.read_only ?? false;

  return (
    <div className="file-accordion">
      <div className="file-accordion-head">
        <button className="file-accordion-toggle" onClick={() => setOpen((value) => !value)}>
          <span>{filePath}</span>
        </button>
        <span className="file-accordion-meta">
          <span className={`badge ${staged ? "staged" : ""}`.trim()}>{staged ? "Staged" : "Unstaged"}</span>
          <span className="muted">{hunks.length}</span>
          {!readOnly ? (
            <button onClick={() => void actions.toggleStageFile(filePath, staged)}>
              {staged ? "Unstage File" : "Stage File"}
            </button>
          ) : null}
        </span>
      </div>
      <div className={`collapsible-content ${open ? "" : "collapsible-content-collapsed"}`.trim()}>
        {hunks.map((hunk) => (
          <HunkCard
            key={hunk.id}
            hunk={hunk}
            agents={agents}
            selectedAgent={selectedAgent}
            onAgentChange={onAgentChange}
          />
        ))}
      </div>
    </div>
  );
}

export function Hunks({ hunks, agents, selectedAgent, onAgentChange }: HunksProps) {
  const [unstagedOpen, setUnstagedOpen] = useState(true);
  const [stagedOpen, setStagedOpen] = useState(false);
  const unstagedGroups = useMemo(() => groupByFile(hunks.filter((hunk) => !hunk.staged)), [hunks]);
  const stagedGroups = useMemo(() => groupByFile(hunks.filter((hunk) => hunk.staged)), [hunks]);

  useEffect(() => {
    setStagedOpen(false);
  }, [stagedGroups.length]);

  return (
    <div className="hunk-sections">
      <section className="panel panel-plain hunk-section">
        <button className="hunk-section-toggle hunk-section-toggle-large" onClick={() => setUnstagedOpen((open) => !open)}>
          <h2>Unstaged</h2>
          <span className="muted">{unstagedGroups.reduce((sum, group) => sum + group.hunks.length, 0)}</span>
        </button>
        <div className={`collapsible-content ${unstagedOpen ? "" : "collapsible-content-collapsed"}`.trim()}>
          {unstagedGroups.length > 0 ? (
            unstagedGroups.map((group) => (
              <FileAccordion
                key={group.filePath}
                filePath={group.filePath}
                hunks={group.hunks}
                agents={agents}
                selectedAgent={selectedAgent}
                onAgentChange={onAgentChange}
                defaultOpen={true}
              />
            ))
          ) : (
            <div className="empty-section muted">No unstaged hunks.</div>
          )}
        </div>
      </section>

      <section className="panel panel-plain hunk-section">
        <button className="hunk-section-toggle hunk-section-toggle-large" onClick={() => setStagedOpen((open) => !open)}>
          <h2>Staged</h2>
          <span className="muted">{stagedGroups.reduce((sum, group) => sum + group.hunks.length, 0)}</span>
        </button>
        <div className={`collapsible-content ${stagedOpen ? "" : "collapsible-content-collapsed"}`.trim()}>
          {stagedGroups.length > 0 ? (
            stagedGroups.map((group) => (
              <FileAccordion
                key={group.filePath}
                filePath={group.filePath}
                hunks={group.hunks}
                agents={agents}
                selectedAgent={selectedAgent}
                onAgentChange={onAgentChange}
                defaultOpen={false}
              />
            ))
          ) : (
            <div className="empty-section muted">No staged hunks.</div>
          )}
        </div>
      </section>
    </div>
  );
}
