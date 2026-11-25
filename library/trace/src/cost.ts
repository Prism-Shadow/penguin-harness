/**
 * The cost math over a Trace's token buckets: the "model price" formula the usage queries
 * aggregate with and the trace analysis' per-turn cost prices each Request with — one
 * implementation, so the two never drift. Rates ride in from the caller (the Project's
 * pricing lookup); this file owns only the arithmetic and the off-peak tier decision.
 */
import {
  catalogEntryFor,
  offPeakAt,
} from "@prismshadow/penguin-library-model/model-catalog/catalog";
import type { PricingRates, TieredRates } from "@prismshadow/penguin-library-model";

export type { PricingRates, TieredRates };
import type { CostParts } from "./trace.js";

/**
 * The Project's current price for a paired reference — the same lookup the usage queries
 * price `usage_records` with, so the analysis' per-turn cost and the toolbar's figure come
 * from one price table. Resolves undefined when the Project carries no pricing.
 */
export type PricingLookup = (
  projectId: string,
  provider: string,
  modelId: string,
) => Promise<TieredRates | undefined>;

/** The "model price" formula: the three buckets at the given rates (USD per million Tokens), in USD. */
export function requestCostUsd(
  counts: { cacheRead: number; cacheWrite: number; output: number },
  rates: PricingRates,
): number {
  return (
    (counts.cacheRead * rates.cacheRead +
      counts.cacheWrite * rates.cacheWrite +
      counts.output * rates.output) /
    1e6
  );
}

/** A cost split with nothing in any bucket: where a running sum of splits starts. */
export const ZERO_COST_PARTS: CostParts = { cacheRead: 0, cacheWrite: 0, output: 0 };

/**
 * {@link requestCostUsd} kept bucket by bucket: each bucket's Tokens at its own rate, in USD.
 * Given the rates a cost was priced at, the parts add up to that cost.
 */
export function requestCostParts(
  counts: { cacheRead: number; cacheWrite: number; output: number },
  rates: PricingRates,
): CostParts {
  return {
    cacheRead: (counts.cacheRead * rates.cacheRead) / 1e6,
    cacheWrite: (counts.cacheWrite * rates.cacheWrite) / 1e6,
    output: (counts.output * rates.output) / 1e6,
  };
}

/** Two cost splits added bucket by bucket. */
export function sumCostParts(a: CostParts, b: CostParts): CostParts {
  return {
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}

/**
 * The rates one usage record is billed at, decided from the record's own timestamp: the
 * off-peak tier when the reference carries a catalog schedule and `at` falls outside its peak
 * windows, the peak tier otherwise. For a reference with no schedule, or whose stored price is
 * no longer the catalog's, the two tiers are the same figure (see project-config-service's
 * `tieredRates`), so the decision changes nothing there. `peakExpr` in the usage repo is this
 * rule written in SQL for the aggregations; the two must agree record for record, which is why
 * an unreadable timestamp — which the repo never stores — takes the peak tier rather than
 * inventing a discount.
 */
export function ratesAt(
  tiered: TieredRates,
  provider: string,
  modelId: string,
  at: Date,
): PricingRates {
  const schedule = catalogEntryFor(provider, modelId)?.offPeakDiscount;
  if (schedule === undefined || Number.isNaN(at.getTime())) return tiered.peak;
  return offPeakAt(schedule, at) ? tiered.offPeak : tiered.peak;
}
