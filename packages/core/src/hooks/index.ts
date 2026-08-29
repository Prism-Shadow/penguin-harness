/**
 * Hooks — functions the Session runs at fixed points of the agent loop. One point exists
 * today, `stop` (after every Task of a `run` call); see stop-hook.ts for the contract and
 * skill-summary-hook.ts for the built-in hook the composition layer registers.
 */
export { runStopHooks, uncachedTokens } from "./stop-hook.js";
export type {
  SessionHooks,
  StopHook,
  StopHookInput,
  StopHookResult,
  StopHooksOutcome,
} from "./stop-hook.js";
export {
  buildSkillSummaryPrompt,
  condenseTrace,
  createSkillSummaryHook,
  invokedSkills,
  SKILL_SUMMARY_HOOK_NAME,
  summaryWindow,
} from "./skill-summary-hook.js";
export type { SkillSummaryHookOptions } from "./skill-summary-hook.js";
