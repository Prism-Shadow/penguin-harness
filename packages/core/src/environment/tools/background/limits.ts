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

/** Cap (characters) on the output tail a background completion report carries. */
export const DONE_REPORT_OUTPUT_CAP = 4000;

/** Keeps the LAST `cap` characters (a run's verdict sits at the end), prefixing a drop marker when truncated. */
export function tailForReport(text: string, cap: number = DONE_REPORT_OUTPUT_CAP): string {
  if (text.length <= cap) return text;
  return `[earlier output dropped: exceeded ${cap} chars]\n${text.slice(text.length - cap)}`;
}

/** Cap (characters) on a completion report's label (the command / prompt excerpt). */
const REPORT_LABEL_CAP = 120;

/** First line of `text`, truncated to the label cap with an ellipsis. */
export function reportLabel(text: string): string {
  const line = text.split("\n", 1)[0] ?? "";
  return line.length <= REPORT_LABEL_CAP ? line : `${line.slice(0, REPORT_LABEL_CAP - 1)}…`;
}
