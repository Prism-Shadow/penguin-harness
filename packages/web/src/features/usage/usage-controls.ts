/**
 * Pure helpers behind the cost center's global controls (date-range presets +
 * time-series precision) and the series shaping the charts draw — the
 * per-entity counts the requests charts stack, the rate values their lines
 * follow, and the empty-bucket compaction the cost and Token charts apply.
 * No React, unit-tested in test/usage-controls.test.ts.
 *
 * The range picks the precision; there is no separate control for it. The
 * trailing "last hour" window is the only thing that reaches minute buckets (a
 * calendar range cannot — a single day by minute is already 1440 points),
 * "last 24 hours" serves hours, and every calendar range is drawn per day,
 * week or month by its length.
 */
import type { UsageGranularity, UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import { cacheHitRate } from "../../lib/format";
import { SERIES_COLORS } from "../../lib/category-colors";

/** Quick range choices; `1h`/`1d` are trailing timestamp windows, the rest calendar ranges (`custom` reveals the two date inputs). */
export type RangePreset = "1h" | "1d" | "7d" | "30d" | "90d" | "custom";

/** Calendar-preset day counts (today inclusive). */
const PRESET_DAYS: Record<"7d" | "30d" | "90d", number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Format a Date as a local `yyyy-mm-dd`. */
export function isoDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The from/to range a calendar preset stands for (today inclusive). */
export function presetRange(
  preset: "7d" | "30d" | "90d",
  today: Date,
): { from: string; to: string } {
  const from = new Date(today);
  from.setDate(from.getDate() - (PRESET_DAYS[preset] - 1));
  return { from: isoDate(from), to: isoDate(today) };
}

/**
 * The trailing timestamp window a `1h`/`1d` preset stands for, computed at
 * load time so a reload keeps trailing "now": the instant bounds plus the
 * local dates they span (the date pair keeps the server's date-column filter
 * effective; the instants refine it).
 */
export function presetTsWindow(
  preset: "1h" | "1d",
  now: Date,
): { fromTs: string; toTs: string; from: string; to: string } {
  const fromDate = new Date(now.getTime() - (preset === "1h" ? 3_600_000 : 86_400_000));
  return {
    fromTs: fromDate.toISOString(),
    toTs: now.toISOString(),
    from: isoDate(fromDate),
    to: isoDate(now),
  };
}

/** Inclusive day count of a `yyyy-mm-dd` range (UTC arithmetic — plain calendar distance, no DST wobble); invalid or reversed ranges count as 1. */
export function rangeDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(ms) || ms < 0) return 1;
  return Math.round(ms / 86_400_000) + 1;
}

/** The precision a custom range is drawn at: daily up to a quarter, weekly up to half a year, monthly beyond. */
export function defaultGranularity(days: number): UsageGranularity {
  if (days <= 92) return "day";
  if (days <= 190) return "week";
  return "month";
}

/**
 * The precision a range is drawn at. There is no precision control — the range
 * picks it, because only one precision reads well per range and every other
 * choice either fuses into a wall of hairlines or hides the shape.
 *
 * Each result must also be a combination the server accepts: it caps a
 * response at 500 buckets, so the trailing hour goes to minute (61 buckets)
 * and the trailing day to hour (25), while every calendar preset stays on day
 * (90 at the widest). `minute` and window-bounded `hour` additionally require
 * the `fromTs`/`toTs` pair, which is exactly what the two trailing presets send.
 */
export function presetDefaultGranularity(preset: RangePreset, days: number): UsageGranularity {
  if (preset === "1h") return "minute";
  if (preset === "1d") return "hour";
  if (preset === "custom") return defaultGranularity(days);
  return "day";
}

/** Short x-axis form of a bucket key: minute/hour `hh:mm`, day/week `mm-dd`, month `yyyy-mm`. */
export function bucketAxisLabel(g: UsageGranularity, key: string): string {
  if (g === "minute" || g === "hour") return key.slice(11);
  if (g === "month") return key;
  return key.slice(5);
}

/** Full bubble form of a bucket key: the key itself, with a minute/hour key's `T` opened up to a space. */
export function bucketFullLabel(g: UsageGranularity, key: string): string {
  return g === "minute" || g === "hour" ? key.replace("T", " ") : key;
}

/** One entity's per-bucket request and success counts, index-aligned with the chart's buckets. */
export interface EntityCounts {
  label: string;
  requests: number[];
  completed: number[];
  denominator: number[];
}

/** A drawable series of a requests chart: one entity's counts, or the folded tail. */
export interface EntitySeries extends EntityCounts {
  /** The folded tail (drawn in neutral gray, after the named ones). */
  other?: boolean;
}

/**
 * How many entities keep a hue of their own. The palette holds exactly this
 * many distinct, CVD-checked line colors, and past it the stack and the lines
 * would repeat a color — so this is the cap, not a taste setting.
 */
export const MAX_NAMED_SERIES = SERIES_COLORS.length;

/**
 * Shape entity series for stacking: the top `max` entities keep their own
 * color, the rest fold into one neutral tail whose label is built from the
 * number folded — the chart says how many entities it stopped naming instead
 * of quietly presenting the head as the whole picture. Input is already
 * sorted by total requests descending (the server's contract).
 */
export function foldEntitySeries(
  entities: readonly EntityCounts[],
  otherLabel: (folded: number) => string,
  max = MAX_NAMED_SERIES,
): EntitySeries[] {
  const named: EntitySeries[] = entities.slice(0, max).map((s) => ({ ...s }));
  const rest = entities.slice(max);
  if (rest.length === 0) return named;
  // A tail of one is not "other": name it (the color is still the neutral one — a label beats a mystery bucket).
  if (rest.length === 1) return [...named, { ...rest[0]!, other: true }];
  return [...named, { ...sumCounts(rest), label: otherLabel(rest.length), other: true }];
}

/** Column sums over a set of series: the stack's height per bucket, and the counts its combined rate comes from. */
export function sumCounts(series: readonly EntityCounts[]): Omit<EntityCounts, "label"> {
  const buckets = series[0]?.requests.length ?? 0;
  const column = (pick: (e: EntityCounts) => number[]) =>
    Array.from({ length: buckets }, (_, i) => series.reduce((s, e) => s + (pick(e)[i] ?? 0), 0));
  return {
    requests: column((e) => e.requests),
    completed: column((e) => e.completed),
    denominator: column((e) => e.denominator),
  };
}

/**
 * Per-bucket success rate in percent, or **null where there is nothing to
 * rate** (denominator 0 — the entity was idle, or every request it made was
 * aborted). Null is not a number the reader may be shown: the hover table
 * prints a dash for it, and plotRates below turns it into a drawing height so
 * the line still crosses the interval.
 */
export function rateSeries(
  counts: Pick<EntityCounts, "completed" | "denominator">,
): (number | null)[] {
  return counts.denominator.map((d, i) => (d > 0 ? ((counts.completed[i] ?? 0) / d) * 100 : null));
}

/** Per-bucket cache hit rate in percent, null where the bucket had no cache traffic at all — the same "no rate here" as a success rate with an empty denominator. */
export function hitRateValues(series: readonly UsageSeriesPoint[]): (number | null)[] {
  return series.map((p) => {
    const rate = cacheHitRate(p.cacheRead, p.cacheWrite);
    return rate === null ? null : rate * 100;
  });
}

/**
 * The height a rate line is drawn at across a bucket that has no rate. The
 * stroke has to cross the interval at *some* height — a hole reads as a claim
 * of its own, and so does dropping to the floor, which is where "made
 * requests and failed every one" lives. The top of the axis is the one height
 * that invents no failure.
 *
 * It is a drawing choice and nothing more: the hover table prints a dash for
 * the same bucket, so the number the reader takes away is never this 100.
 */
export const NO_RATE_PLOT = 100;

/** Drawing values for a rate line: every bucket gets a height, the ones with no rate at NO_RATE_PLOT. */
export function plotRates(values: readonly (number | null)[]): number[] {
  return values.map((v) => v ?? NO_RATE_PLOT);
}

/** A time series with its empty buckets dropped: the buckets that survived, where they sat, and where the axis now jumps. */
export interface CompactSeries {
  /** The buckets that recorded something, in order. */
  points: UsageSeriesPoint[];
  /**
   * Where each surviving bucket sat in the original series. The per-entity
   * counts arrive aligned index-for-index with that array, so they have to be
   * re-indexed through this to stay aligned with `points` — see compactCounts.
   */
  kept: number[];
  /** Indices in `points` after which at least one bucket was dropped — where the axis jumps in time. */
  breaks: number[];
}

/**
 * Drop the buckets that recorded nothing. The survivors are handed to
 * makeGeom as the entire series, so the coordinate system spreads them evenly
 * over the plot area on its own: one point sits in the middle of the card,
 * two at a quarter and three quarters, and the divisions subdivide as points
 * are added. Left to right, only what happened — the shape the charts had
 * before the range control existed.
 *
 * Emptiness is a property of the **bucket**, never of one entity in it: an
 * interval where anything at all ran stays, and the entities that did not run
 * in it show their zeros and dashes there. That is what lets every chart on
 * the page compact through this one call and keep one shared axis.
 *
 * `breaks` is what the axis is drawn with, since an axis that skips intervals
 * must not read as a continuous one.
 */
export function compactSeries(series: readonly UsageSeriesPoint[]): CompactSeries {
  const points: UsageSeriesPoint[] = [];
  const kept: number[] = [];
  const breaks: number[] = [];
  let dropping = false;
  series.forEach((p, i) => {
    // Nothing was recorded in this bucket: no request, and no tokens either
    // (a request that spent nothing is still a request, and keeps its bucket).
    if (p.requests === 0 && p.total === 0) {
      dropping = true;
      return;
    }
    // A break belongs *between* two drawn points; buckets dropped before the
    // first one (or after the last) shorten the axis without breaking it.
    if (dropping && points.length > 0) breaks.push(points.length - 1);
    dropping = false;
    kept.push(i);
    points.push(p);
  });
  return { points, kept, breaks };
}

/**
 * Re-index one entity's per-bucket counts onto the compacted bucket list.
 * The server aligns these arrays index-for-index with `series`; dropping
 * buckets from the series without dropping the same positions here would
 * shift every entity's history sideways and silently attribute its counts to
 * the wrong intervals. One `kept` list for the series and for every entity is
 * what makes that impossible.
 */
export function compactCounts(
  counts: Omit<EntityCounts, "label">,
  kept: readonly number[],
): Omit<EntityCounts, "label"> {
  const pick = (values: readonly number[]) => kept.map((i) => values[i] ?? 0);
  return {
    requests: pick(counts.requests),
    completed: pick(counts.completed),
    denominator: pick(counts.denominator),
  };
}
