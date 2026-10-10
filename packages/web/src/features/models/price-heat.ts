/**
 * Price heat: where a model's price sits on the models page's cool → hot scale — the dot that
 * leads a card's third line, so the list can be scanned for price without reading figures.
 *
 * **What it encodes.** The blended price per million tokens, `(cache_write × 3 + output) ÷ 4`, in
 * USD. `cache_write` is the uncached-input price (a cache miss is billed as a write); agent
 * traffic is input-heavy and output costs several times more per token, so three parts input to
 * one part output weights the two buckets by what they cost a session — the convention public
 * price indexes use for one blended figure. `cache_read` is left out: its share depends on the
 * harness's cache discipline, not on the model, and vendors price it at or near zero unevenly.
 * The caller passes the price billed right now (list, less a running promotion, less a live
 * off-peak tier), the figures the card prints, so the colour and the figures never disagree.
 *
 * **The scale.** Logarithmic between two fixed USD bounds, clamped: $0.125 is t = 0 and $32 is
 * t = 1. Prices span four orders of magnitude, so only a log scale spreads them; the bounds are the
 * level breakpoints' ×4 ladder (0.5 / 2 / 8) extended one step each way, which holds all but the
 * cheapest few and the Pro tier of the catalog's priced rows inside the ramp, puts the catalog's
 * median ($1.5) near the middle, and lands each level on an exact quarter of the ramp. Fixed, not
 * relative to what is on screen: a colour must mean the same thing whatever the search, the
 * folded groups or the Project.
 *
 * **The level.** A word for the tooltip — low, medium, high, very high — by the breakpoints
 * alone. It is text beside the colour, not a fifth of a discrete scale: the colour is continuous.
 *
 * Free rows (a zero blend) and unpriced rows have no heat: zero has no place on a log scale and
 * the "free" badge already marks it, and an absent price is not a cheap one.
 */
import { bucketValue } from "./model-grouping";
import type { PricingBucketsLike } from "./model-grouping";

/** The blended USD per million tokens at either end of the ramp: t = 0 at `cool`, 1 at `hot`. */
export const PRICE_HEAT_BOUNDS_USD = { cool: 0.125, hot: 32 } as const;

/** Blended USD per million tokens where the level words change; a price on a breakpoint takes the upper word. */
export const PRICE_LEVEL_BREAKPOINTS_USD = [0.5, 2, 8] as const;

export const PRICE_LEVELS = ["low", "medium", "high", "veryHigh"] as const;
export type PriceLevel = (typeof PRICE_LEVELS)[number];

export interface PriceHeat {
  /** The position on the ramp, 0 (cool) to 1 (hot). */
  t: number;
  /** The blended price the position encodes, USD per million tokens. */
  blendedUsd: number;
  level: PriceLevel;
}

/** The blended price per million tokens: three parts uncached input to one part output. */
export function blendedPrice(cacheWrite: number, output: number): number {
  return (cacheWrite * 3 + output) / 4;
}

/** Where a positive blended USD price sits on the ramp, clamped to 0–1. */
export function heatPosition(blendedUsd: number): number {
  const { cool, hot } = PRICE_HEAT_BOUNDS_USD;
  return Math.min(1, Math.max(0, Math.log(blendedUsd / cool) / Math.log(hot / cool)));
}

/**
 * The level word for a blended USD price. The catalog stores a vendor's yuan price in dollars
 * rounded to a millionth, so a yuan price exactly on a breakpoint (DeepSeek Flash's ¥3.5, which is
 * $0.5) lands a hair under it; comparing at a hundred-thousandth of a dollar puts it on the
 * breakpoint, where a dollar-listed price of the same value is.
 */
export function priceLevel(blendedUsd: number): PriceLevel {
  const usd = Math.round(blendedUsd * 1e5) / 1e5;
  const below = PRICE_LEVEL_BREAKPOINTS_USD.findIndex((edge) => usd < edge);
  return PRICE_LEVELS[below === -1 ? PRICE_LEVELS.length - 1 : below]!;
}

/**
 * The heat of a row's price buckets, or undefined for a row with no mark: unpriced (the uncached
 * input or the output price is blank or missing) or free (a zero blend).
 */
export function priceHeat(buckets: PricingBucketsLike): PriceHeat | undefined {
  const cacheWrite = bucketValue(buckets.cacheWrite);
  const output = bucketValue(buckets.output);
  if (cacheWrite === undefined || output === undefined) return undefined;
  const blendedUsd = blendedPrice(cacheWrite, output);
  if (!(blendedUsd > 0)) return undefined;
  return { t: heatPosition(blendedUsd), blendedUsd, level: priceLevel(blendedUsd) };
}
