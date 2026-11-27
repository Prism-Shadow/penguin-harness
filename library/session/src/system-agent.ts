/**
 * The refusal that keeps the system Agent what it is (PRFC-0033) at the session create path:
 * 409 `system_agent_no_sessions` — a Session on it, from wherever it is asked for (the session
 * service's create path, which every surface reaches, and the Agent API's settings route).
 * It asks core's predicate (the id `system_agent` with its `system: true` key), so an Agent the
 * user named `system_agent` before the system Agent existed is refused nothing (compat C1, core
 * state/system-agent.ts). Moved from the agent domain package's refusals module
 * (services+http+cli restack S14 — the session service speaks it at runtime); the agent package
 * re-exports it unchanged beside its sibling refusals.
 */
import { HttpError } from "@prismshadow/penguin-library-http";
import type { AgentConfig } from "@prismshadow/penguin-library-agent/contract";

/** What every refusal asks: the AgentConfig mechanism's predicate (the same shape the agent package's system-agent refusals take). */
type SystemAgentLookup = Pick<AgentConfig, "isSystemAgent">;

/** Throws 409 `system_agent_no_sessions` when the Agent is the system Agent. */
export async function refuseSystemAgentSessions(
  agents: SystemAgentLookup,
  projectId: string,
  agentId: string,
): Promise<void> {
  if (await agents.isSystemAgent(projectId, agentId)) {
    throw new HttpError(
      409,
      "system_agent_no_sessions",
      "The system Agent owns the system apps and runs no Sessions.",
    );
  }
}
