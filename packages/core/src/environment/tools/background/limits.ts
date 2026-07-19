/**
 * Yield-time clamping shared by background-session tools.
 *
 * `yield_time_ms` is a soft budget for a single tool call: "wait at most until the session ends
 * or this duration expires" (expiry yields, it's not a failure). Only a lower bound is set: a
 * wait that's too short isn't meaningful and just adds round trips. The upper bound is no longer
 * an independent constant — it's derived from the tool's own `timeoutMs` (with a reserved
 * margin, so the yield happens before the Environment's timeout fallback fires); no upper bound
 * is set when `timeoutMs <= 0` (disabled).
 */

/** Lower bound for yield time (ms). */
export const MIN_YIELD_MS = 250;
/** Margin (ms) reserved between the yield upper bound and the tool's `timeoutMs`: the yield must happen before the timeout fallback. */
const TIMEOUT_MARGIN_MS = 1_000;

/** Clamps the raw argument to `[MIN_YIELD_MS, timeoutMs - margin]`; falls back to `fallback` if not a number, no upper bound when `timeoutMs <= 0`. */
export function clampYield(raw: unknown, fallback: number, timeoutMs?: number): number {
  const n = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
  const lower = Math.max(n, MIN_YIELD_MS);
  if (timeoutMs === undefined || timeoutMs <= 0) return lower;
  return Math.min(lower, Math.max(timeoutMs - TIMEOUT_MARGIN_MS, MIN_YIELD_MS));
}
