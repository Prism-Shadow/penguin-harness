/**
 * Hooks — functions the Session runs at fixed points of the agent loop. One point exists
 * today, `stop` (after every Task of a `run` call): stop-hook.ts is the in-process contract
 * and the loop's pass over the hooks, script-hook.ts runs the hook packages installed into
 * an Agent's `agent_state/hooks/` as subprocesses.
 */
export { runStopHooks, uncachedTokens } from "./stop-hook.js";
export type {
  HookSubagentRequest,
  HookSubagentSpawner,
  SessionHooks,
  StopHook,
  StopHookInput,
  StopHookResult,
  StopHooksOutcome,
} from "./stop-hook.js";
export {
  DEFAULT_HOOK_TIMEOUT_S,
  parseStopHookResult,
  runHookScript,
  scriptStopHook,
} from "./script-hook.js";
export type { RunHookScriptOptions } from "./script-hook.js";
