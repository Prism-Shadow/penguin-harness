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
/**
 * Default wait duration (milliseconds) for `input_command` on an empty poll: a default-length
 * poll waits out most builds/test runs in one call instead of ping-ponging short polls (data
 * still streams as it arrives — the wait only ends early on exit). Must stay below
 * `input_command`'s default `timeoutMs` (120000, the same tier as `exec_command`) minus the
 * clamp margin (see ../background/limits.ts); the 10 s of headroom lets a default-length poll
 * return on its own instead of being cut off by the Environment's timeout fallback.
 */
export const DEFAULT_EMPTY_POLL_YIELD_MS = 110_000;
