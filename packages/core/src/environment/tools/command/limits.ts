/**
 * Default yield durations for long-running command sessions.
 *
 * `yield_time_ms` is the soft budget for a tool call to "wait at most until the command ends or
 * this duration elapses" (yielding on expiry is not a failure); see `../background/limits.ts`
 * for the clamping logic: it only sets a floor, the ceiling is derived from the tool's own
 * `timeoutMs`.
 */

/** Default wait duration (milliseconds) for `exec_command` starting a command. */
export const DEFAULT_EXEC_YIELD_MS = 60_000;
/** Default wait duration (milliseconds) for `input_command` when there's a write. */
export const DEFAULT_WRITE_YIELD_MS = 250;
/** Default wait duration (milliseconds) for `input_command` on an empty poll. */
export const DEFAULT_EMPTY_POLL_YIELD_MS = 5_000;
