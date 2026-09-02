/**
 * Hooks — functions the Session runs at fixed points of the agent loop. Three points exist
 * today: `stop` (after every Task of a `run` call; stop-hook.ts), `pre_tool_use` (before
 * each tool call's approval; tool-hook.ts) and `user_prompt` (prompt expansion, run via
 * `Session.runUserPromptHook`; prompt-hook.ts). script-hook.ts runs the hook packages
 * installed into an Agent's `agent_state/hooks/` as subprocesses — hooks run in core and
 * nowhere else; hosts trigger them through Session APIs.
 */
export { runStopHooks } from "./stop-hook.js";
export type {
  HookSubagentRequest,
  HookSubagentSpawned,
  HookSubagentSpawner,
  SessionHooks,
  StopHook,
  StopHookInput,
  StopHookResult,
  StopHooksOutcome,
} from "./stop-hook.js";
export { runPreToolUseHooks } from "./tool-hook.js";
export type { PreToolUseHook, PreToolUseHookInput, PreToolUseHookResult } from "./tool-hook.js";
export type { UserPromptHook, UserPromptHookInput, UserPromptHookResult } from "./prompt-hook.js";
export {
  DEFAULT_HOOK_TIMEOUT_S,
  parsePreToolUseResult,
  parseStopHookResult,
  parseUserPromptResult,
  runHookScript,
  scriptPreToolUseHook,
  scriptStopHook,
  scriptUserPromptHook,
} from "./script-hook.js";
export type { RunHookScriptOptions } from "./script-hook.js";
