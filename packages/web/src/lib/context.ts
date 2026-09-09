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
