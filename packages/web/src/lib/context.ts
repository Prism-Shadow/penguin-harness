/**
 * Context window resolution and the basis the composer's context ring fills against.
 *
 * Two different upper bounds live here, and confusing them is what this module exists to
 * prevent. `resolveContextWindow` answers "how much can this model hold at all" and falls back
 * to 128000 when a model entry has no `context_window`; it is what the Trace page's per-round
 * donuts and the model readouts want. The composer's ring wants the other one: the point
 * **compaction fires**, which is what decides whether to keep going or compact now. On a model
 * whose window dwarfs the Agent's threshold the two are far apart — 64k used against a 128k
 * threshold on a 1M window is half full, not 6% full — so the ring reads the threshold.
 *
 * The threshold arithmetic itself is core's (`effectiveMaxContextLength`), imported rather than
 * restated: the number drawn here has to be the number the Agent actually compacts at, and two
 * copies of that rule would eventually disagree.
 *
 * The panel's bar keeps the window as its scale, and marks the threshold on it with a draggable
 * cutter; the second half of this module is that cutter's arithmetic — pointer position to
 * proposed tokens, tokens to bar position, and what the window does to a value typed past it.
 * It lives here rather than in the component because it is the part worth pinning down: a
 * rounding or clamping mistake in a gesture that rewrites an Agent's configuration is not
 * something a render test would catch.
 */
import {
  DEFAULT_MAX_CONTEXT_LENGTH,
  effectiveMaxContextLength,
} from "@prismshadow/penguin-core/context-limits";

/** Default upper bound when a model has no configured context window. */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/** Resolves the context window upper bound: uses the value if positive (or a string parseable as positive), otherwise falls back to 128000. */
export function resolveContextWindow(x: number | string | undefined | null): number {
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : DEFAULT_CONTEXT_WINDOW;
}

/**
 * The Agent's configured compaction threshold, filling in the seeded default for a config that
 * carries no `compaction.max_context_length` of its own — the same substitution core makes when
 * it builds a Session's compaction settings, so the composer never reasons from a threshold the
 * Agent does not actually run at.
 *
 * This is the CONFIGURED value, not the effective one: it is what the Agent settings page edits,
 * and the only value the small-window notice below can be judged against.
 */
export function configuredCompactionLimit(maxContextLength: number | undefined): number {
  return maxContextLength ?? DEFAULT_MAX_CONTEXT_LENGTH;
}

/**
 * Upper bound the context ring, its panel header and its bar are all drawn against: the
 * effective compaction threshold — the configured threshold capped by what the model's window
 * leaves room for — so a full ring means "compaction is about to fire".
 *
 * Falls back to the resolved window in the two cases where no threshold applies: compaction
 * switched off (`<= 0`), and a caller with no Agent config at hand (the subagent composer,
 * and the moment before the config arrives), which passes `undefined`.
 */
export function contextFillBasis(
  compactionLimit: number | undefined,
  contextWindow: number | string | undefined | null,
): number {
  // Resolve first, then derive: core's own resolution only accepts a number, so a Trace-shaped
  // numeric string would reach it as "unconfigured" and silently derive from 128000 instead.
  const windowTokens = resolveContextWindow(contextWindow);
  if (compactionLimit === undefined) return windowTokens;
  const threshold = effectiveMaxContextLength(compactionLimit, windowTokens);
  return threshold > 0 ? threshold : windowTokens;
}

/**
 * Whether the selected model cannot hold what the Agent is configured to compact at: the model
 * declares a window smaller than the Agent's configured `compaction.max_context_length`.
 *
 * Judged on the CONFIGURED threshold, never the effective one — the effective value is already
 * capped by the window, so it can never exceed it and the question would never be asked. The
 * situation is not fatal (compaction still fires at the capped point), but it means the
 * threshold the user set is not the threshold in force, and lowering it below the window is
 * what makes their number real again.
 *
 * False when the model has no configured window (nothing to compare) and when compaction is
 * off (`<= 0`), where no threshold is in force to disagree with.
 */
export function modelWindowBelowCompactionLimit(
  modelContextWindow: number | undefined,
  compactionLimit: number | undefined,
): boolean {
  if (modelContextWindow === undefined || compactionLimit === undefined) return false;
  return compactionLimit > 0 && modelContextWindow < compactionLimit;
}

/**
 * Granularity of the panel's threshold cutter, in tokens. A threshold is a coarse quantity —
 * nobody means 127,431 — so a drag and an arrow key both land on this lattice, which is also
 * what makes a dragged value readable the moment it appears.
 */
export const THRESHOLD_STEP = 1000;

/**
 * Floor of the cutter's travel. One step, so the extreme left is on the same lattice as every
 * other stop, and above all NOT zero: zero is the configured value that means "compaction off",
 * and a gesture aimed at "compact very early" must never be read as "never compact". Switching
 * compaction off stays an Agent-settings decision, where the field says what the value means.
 */
export const MIN_COMPACTION_THRESHOLD = THRESHOLD_STEP;

/**
 * Rounds a proposed threshold onto the step lattice and clamps it to the cutter's travel —
 * `[MIN_COMPACTION_THRESHOLD, the model window]`.
 *
 * The upper clamp is applied AFTER rounding and is the window itself, not the nearest step
 * below it: a 32768-token window would otherwise stop the cutter at 32,000 and leave the bar's
 * right edge unreachable. Beyond the window is refused here because there is nothing to point
 * at past the bar's end — the confirmation dialog's number field is where a threshold above the
 * window is typed deliberately, and it says there what the window will do to it.
 */
export function snapThreshold(tokens: number, windowTokens: number): number {
  const max = Math.max(windowTokens, MIN_COMPACTION_THRESHOLD);
  const stepped = Math.round(tokens / THRESHOLD_STEP) * THRESHOLD_STEP;
  return Math.min(Math.max(stepped, MIN_COMPACTION_THRESHOLD), max);
}

/**
 * Where along the bar (0..1) a threshold is drawn. The bar's scale is the model window, so this
 * is the plain ratio — clamped, because a threshold above the window has to pin the cutter to
 * the right edge rather than leave the bar: the cutter is the control that lowers such a
 * threshold, so it is the last thing that may disappear when the threshold is wrong.
 */
export function thresholdFraction(threshold: number, windowTokens: number): number {
  if (!(windowTokens > 0)) return 0;
  return Math.min(1, Math.max(0, threshold / windowTokens));
}

/**
 * Pointer position to proposed threshold: the x coordinate is read against the bar's own box
 * (viewport coordinates, as `getBoundingClientRect` gives them), turned into a fraction of the
 * window, then snapped. A zero-width box — a bar measured while the panel is mid-animation —
 * yields the floor rather than a NaN that would travel into the dialog.
 */
export function thresholdFromPointer(
  pointerX: number,
  barLeft: number,
  barWidth: number,
  windowTokens: number,
): number {
  if (!(barWidth > 0)) return MIN_COMPACTION_THRESHOLD;
  const fraction = Math.min(1, Math.max(0, (pointerX - barLeft) / barWidth));
  return snapThreshold(fraction * windowTokens, windowTokens);
}

/**
 * The threshold actually in force for a value the user typed, when the model window cuts it
 * down; null when the typed value is what will run. Feeds the dialog's hint, which has to name
 * the number rather than only warn that one exists.
 */
export function thresholdCappedByWindow(
  threshold: number,
  contextWindow: number | string | undefined | null,
): number | null {
  const windowTokens = resolveContextWindow(contextWindow);
  const effective = effectiveMaxContextLength(threshold, windowTokens);
  return effective < threshold ? effective : null;
}
