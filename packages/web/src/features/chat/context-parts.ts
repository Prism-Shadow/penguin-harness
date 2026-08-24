/**
 * Context composition rows: the server's estimated parts, re-expressed on the scale the context
 * ring actually shows.
 *
 * The server splits a Session's current model context into six parts and ranks the tools whose
 * traffic occupies the most of it, sizing everything with a character heuristic rather than a
 * tokenizer (this project bundles none). Taken as counts those figures would contradict the
 * ring, which reports the provider's own measurement; taken as **shares** they are exactly what
 * the ring cannot say. So each part is expressed as its share of the estimate, applied to `now`
 * — the parts add up to the occupancy in the panel header, and the estimate's absolute error
 * never reaches the display.
 *
 * Pure, no React: unit-tested in test/context-parts.test.ts, rendered by context-gauge.tsx.
 */
import type { SessionContextResponse } from "@prismshadow/penguin-server/api";
import { CONTEXT_PART_COLORS } from "../../lib/category-colors";

/** The six parts, by the DTO field each reads. Callers resolve a key to its label at render time — `S` is a live binding and must not be captured in a module constant. */
export type ContextPartKey =
  | "systemPrompt"
  | "toolDefs"
  | "userMessages"
  | "assistantMessages"
  | "toolRequests"
  | "toolResults";

/**
 * Display order of the parts, from the fixed prefix every request carries to the traffic that
 * accumulates during a conversation. It is also the order CONTEXT_PART_COLORS was validated in —
 * the two are zipped below, so reordering either without the other silently repaints the legend.
 */
export const CONTEXT_PART_KEYS: readonly ContextPartKey[] = [
  "systemPrompt",
  "toolDefs",
  "userMessages",
  "assistantMessages",
  "toolRequests",
  "toolResults",
];

export interface ContextShare {
  /** Estimated tokens re-expressed on the measured scale. */
  tokens: number;
  /** Whole-percent share of the whole context. */
  percent: number;
}

export interface ContextPartShare extends ContextShare {
  key: ContextPartKey;
  /** Background class of this part's bar segment and legend swatch. */
  color: string;
}

export interface ContextToolShare extends ContextShare {
  name: string;
}

export interface ContextComposition {
  parts: ContextPartShare[];
  /** Tools ranked by the context their calls and results occupy; their shares are of the whole context, so they do not sum to 100. */
  tools: ContextToolShare[];
}

/**
 * Composition rows for a measured occupancy of `now` tokens, or **null** when there is nothing
 * to break down — an estimate of zero (a Session whose context holds no recorded message yet),
 * or a context a completed compaction has closed, whose composition describes what was
 * compacted away rather than what the model now carries.
 */
export function contextComposition(
  data: SessionContextResponse,
  now: number,
): ContextComposition | null {
  if (data.contextClosed || data.total <= 0) return null;
  const estimates = CONTEXT_PART_KEYS.map((key) => data[key]);
  // Apportioned rather than rounded independently: a panel whose parts read 50/40/9/1/1/1 does
  // not describe one context, and its own header would contradict it. Both columns are laid out
  // so they land on exactly the measured occupancy and exactly 100%.
  const tokens = apportion(estimates, now);
  const percents = apportion(estimates, 100);
  return {
    parts: CONTEXT_PART_KEYS.map((key, i) => ({
      key,
      color: CONTEXT_PART_COLORS[i] ?? "",
      tokens: tokens[i] ?? 0,
      percent: percents[i] ?? 0,
    })),
    // A ranking, not a partition: these are shares of the whole context and sum to less than it,
    // so there is nothing to apportion against — each is simply rounded.
    tools: data.topTools.map((t) => ({
      name: t.name,
      tokens: Math.round((t.tokens / data.total) * now),
      percent: Math.round((t.tokens / data.total) * 100),
    })),
  };
}

/**
 * Splits `total` across `values` in proportion, as whole numbers that sum to exactly `total`
 * (largest remainder: everyone takes their floor, and the leftover units go to the largest
 * fractional parts first). Independent rounding would leave the column short or over by a few
 * units — visible as a percentage column adding up to 102.
 */
function apportion(values: readonly number[], total: number): number[] {
  const sum = values.reduce((n, v) => n + v, 0);
  if (sum <= 0) return values.map(() => 0);
  const exact = values.map((v) => (v / sum) * total);
  const out = exact.map((v) => Math.floor(v));
  let left = Math.round(total) - out.reduce((n, v) => n + v, 0);
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    // Index breaks ties so the leftover always lands on the same part for the same input.
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}
