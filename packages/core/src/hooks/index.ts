/**
 * Hooks — functions the Session runs at fixed points of the agent loop. Three points exist
 * today: `stop` (after every Task of a `run` call; stop-hook.ts), `pre_tool_use` (before
 * each tool call's approval; tool-hook.ts) and `user_prompt` (prompt expansion, every time
 * the user submits a Prompt; prompt-hook.ts). script-hook.ts runs the hook packages
 * installed into an Agent's `agent_state/hooks/` as subprocesses — hooks run in core and
 * nowhere else; a host reaches a flow of its own through a Session API.
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
export { runUserPromptHooks } from "./prompt-hook.js";
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
