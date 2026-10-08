/** Which agent runs the agent-driven stages when the author has not picked one. */

/** The builtin agent the stages default to: it carries the WAF authoring Skills. */
export const ACTIVITY_AGENT_ID = "activity_agent";

/**
 * The author's pick, else the Activity Agent, else the agent in use, else the first agent.
 *
 * The Activity Agent can be absent from a list loaded before the server provisioned it for an
 * older Project, so it is only chosen when the list has it.
 */
export function stageAgent(
  picked: string,
  agents: readonly { agentId: string }[],
  current: string | undefined,
): string {
  if (picked) return picked;
  if (agents.some((agent) => agent.agentId === ACTIVITY_AGENT_ID)) return ACTIVITY_AGENT_ID;
  return current || agents[0]?.agentId || "";
}
