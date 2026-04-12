import type { AgentKind, AgentOption } from "../types";

type AgentSelectProps = {
  agents: AgentOption[];
  selectedAgent: AgentKind;
  onAgentChange: (agent: AgentKind) => void;
  className?: string;
};

export function AgentSelect({
  agents,
  selectedAgent,
  onAgentChange,
  className = "agent-picker",
}: AgentSelectProps) {
  return (
    <label className={className}>
      <select value={selectedAgent} onChange={(event) => onAgentChange(event.target.value as AgentKind)}>
        {agents.map((agent) => (
          <option key={agent.kind} value={agent.kind} disabled={!agent.available}>
            {agent.label}
            {agent.available ? "" : " (Unavailable)"}
          </option>
        ))}
      </select>
    </label>
  );
}
