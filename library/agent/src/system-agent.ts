/**
 * The refusals that keep the system Agent what it is (PRFC-0033): it runs no Session, takes no
 * plugin, and its identity is locked. Each one asks core's predicate (the id `system_agent` with
 * its `system: true` key), so an Agent the user named `system_agent` before the system Agent
 * existed is refused nothing (compat C1, core state/system-agent.ts).
 *
 * - 409 `system_agent_no_sessions`: a Session on it, from wherever it is asked for (the session
 *   service's create path, which every surface reaches), and its Agent API settings. Moved to
 *   the session domain package (services+http+cli restack S14 — the session service speaks it
 *   at runtime); re-exported here beside its siblings.
 * - 409 `system_agent_closed`: a plugin install on it.
 * - 409 `builtin_agent_locked`: a change of its name, description or author, its export, and an
 *   import that would overwrite it.
 * - 409 `agent_id_reserved`: a new Agent taking its id in a Project that does not have it yet.
 *
 * Moved from the server's services/system-agent.ts beside the AgentConfig contract and the
 * agent config service that consumes them (services+http+cli restack S3).
 */
import { SYSTEM_AGENT_ID } from "@prismshadow/penguin-core";
import { HttpError } from "@prismshadow/penguin-library-http";
import type { AgentConfig } from "./contract.js";

/** What every refusal asks: the AgentConfig mechanism's predicate. */
export type SystemAgentLookup = Pick<AgentConfig, "isSystemAgent">;

export { refuseSystemAgentSessions } from "@prismshadow/penguin-library-session/system-agent";

/** Throws 409 `system_agent_closed` when the Agent is the system Agent. */
export async function refuseSystemAgentInstall(
  agents: SystemAgentLookup,
  projectId: string,
  agentId: string,
): Promise<void> {
  if (await agents.isSystemAgent(projectId, agentId)) {
    throw new HttpError(
      409,
      "system_agent_closed",
      "The system Agent takes no plugins: install the plugin on another Agent.",
    );
  }
}

/** What `builtin_agent_locked` says, by the act it refuses. */
const LOCKED = {
  identity: "The system Agent's name, description and author cannot be changed.",
  export: "The system Agent cannot be exported: it holds only the platform's data.",
  overwrite: "An import cannot overwrite the system Agent.",
} as const;

/** Throws 409 `builtin_agent_locked` when the Agent is the system Agent. */
export async function refuseSystemAgentChange(
  agents: SystemAgentLookup,
  projectId: string,
  agentId: string,
  act: keyof typeof LOCKED,
): Promise<void> {
  if (await agents.isSystemAgent(projectId, agentId)) {
    throw new HttpError(409, "builtin_agent_locked", LOCKED[act]);
  }
}

/**
 * Throws 409 `agent_id_reserved` for a new Agent taking the system Agent's id: reached only where
 * the id is still free, in a Project that has not been given its system Agent yet.
 */
export function refuseReservedAgentId(agentId: string): void {
  if (agentId === SYSTEM_AGENT_ID) {
    throw new HttpError(
      409,
      "agent_id_reserved",
      `Agent id ${agentId} is reserved for the system Agent; choose another id.`,
    );
  }
}
