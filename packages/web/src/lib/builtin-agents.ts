/**
 * The built-in Agents: provisioned with every Project and never deleted — the server refuses
 * with 409 `cannot_delete_builtin_agent` — so no surface offers to delete one. The Agents page
 * draws their delete as a disabled mark, and deleting an organization keeps them.
 *
 * The system Agent is one of them, told by the server's `system` flag rather than by its id. It
 * owns the system apps and runs no conversation, so it is never offered where an Agent is picked
 * to talk to, run, schedule, evaluate, install onto, hire or hand a prompt to: every such list
 * filters through `isConversationAgent`. An Agent the user named `system_agent` before the system
 * Agent existed carries no flag and stays an ordinary Agent; the Agents page asks its owner to
 * move it to another id (`holdsSystemAgentId`).
 */
import type { AgentSummary } from "@prismshadow/penguin-server/api";

const BUILTIN_AGENT_IDS: ReadonlySet<string> = new Set(["default_agent", "penguin_support"]);

/** The id the server reserves for the system Agent. */
const SYSTEM_AGENT_ID = "system_agent";

/** What the predicates read off an Agent. */
type AgentFacts = Pick<AgentSummary, "agentId" | "system">;

/** Whether the Agent is the Project's system Agent. */
export function isSystemAgent(agent: Pick<AgentSummary, "system">): boolean {
  return agent.system === true;
}

/** Whether the Agent is a built-in Agent. */
export function isBuiltinAgent(agent: AgentFacts): boolean {
  return isSystemAgent(agent) || BUILTIN_AGENT_IDS.has(agent.agentId);
}

/** Whether the Agent can be picked for a conversation or any other run: every Agent but the system Agent. */
export function isConversationAgent(agent: Pick<AgentSummary, "system">): boolean {
  return !isSystemAgent(agent);
}

/** Whether an Agent of the user's holds the id reserved for the system Agent, which the Project then lacks. */
export function holdsSystemAgentId(agent: AgentFacts): boolean {
  return agent.agentId === SYSTEM_AGENT_ID && !isSystemAgent(agent);
}
