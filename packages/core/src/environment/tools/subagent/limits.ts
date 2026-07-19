/**
 * Default yield duration for background subagent sessions.
 *
 * See `../background/limits.ts` for the clamping logic: only a lower bound is set, and the
 * upper bound is derived from the tool's own `timeoutMs`.
 */

/** Default wait duration (ms) for `run_subagent` launching a task and `input_subagent` appending a Prompt to continue. */
export const DEFAULT_SUBAGENT_YIELD_MS = 300_000;
/** Default wait duration (ms) for `input_subagent` empty polling. */
export const DEFAULT_SUBAGENT_POLL_YIELD_MS = 10_000;
