/**
 * Barrel for the background subagent session module.
 */
export { SubagentSessionManager } from "./session-manager.js";
export { ManagedSubagentSession, resultForSubagentExit } from "./session.js";
export type { SubagentExit } from "./session.js";
export { DEFAULT_SUBAGENT_YIELD_MS, DEFAULT_SUBAGENT_POLL_YIELD_MS } from "./limits.js";
