/**
 * Hooks — functions the Session runs at fixed points of the agent loop. Two points exist
 * today: `stop` (after every Task of a `run` call; stop-hook.ts) and `pre_tool_use` (before
 * each tool call's approval; tool-hook.ts). script-hook.ts runs the hook packages installed
 * into an Agent's `agent_state/hooks/` as subprocesses.
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
export { runPreToolUseHooks } from "./tool-hook.js";
export type { PreToolUseHook, PreToolUseHookInput, PreToolUseHookResult } from "./tool-hook.js";
export {
  DEFAULT_HOOK_TIMEOUT_S,
  parsePreToolUseResult,
  parseStopHookResult,
  runHookScript,
  scriptPreToolUseHook,
  scriptStopHook,
} from "./script-hook.js";
export type { RunHookScriptOptions } from "./script-hook.js";
