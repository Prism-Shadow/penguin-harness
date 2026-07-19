/**
 * Barrel for the long-running command session module.
 */
export { CommandSessionManager } from "./session-manager.js";
export { ManagedSession, resultForExit } from "./session.js";
export type { ProcessExit, SpawnOptions } from "./session.js";
export {
  DEFAULT_EXEC_YIELD_MS,
  DEFAULT_WRITE_YIELD_MS,
  DEFAULT_EMPTY_POLL_YIELD_MS,
} from "./limits.js";
