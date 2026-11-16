/**
 * The built-in Agents: provisioned with every Project and never deleted — the server refuses
 * with 409 `cannot_delete_builtin_agent` — so no surface offers to delete one. The Agents page
 * draws their delete as a disabled mark, and deleting an organization keeps them.
 */
const BUILTIN_AGENT_IDS: ReadonlySet<string> = new Set(["default_agent", "penguin_support"]);

/** Whether `agentId` names a built-in Agent. */
export function isBuiltinAgent(agentId: string): boolean {
  return BUILTIN_AGENT_IDS.has(agentId);
}
