/**
 * Pure helpers behind the cost center's global controls (date-range presets +
 * time-series precision) and the per-entity series shaping the requests charts
 * draw — no React, unit-tested in test/usage-controls.test.ts.
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
 * Per-bucket success rate in percent. A bucket with nothing to rate
 * (denominator 0 — the entity was idle, or every request was aborted) reads
 * **0**, so the line stays continuous and never leaves a hole a reader has to
 * interpret. It is deliberately not 100: an interval an entity never ran in
 * has not earned a perfect record. Because 0 therefore means two different
 * things, the hover text names which one — see idleBuckets.
 */
export function rateSeries(counts: Pick<EntityCounts, "completed" | "denominator">): number[] {
  return counts.denominator.map((d, i) => (d > 0 ? ((counts.completed[i] ?? 0) / d) * 100 : 0));
}

/** Buckets where a rate of 0 means "nothing was rated here" rather than "everything failed" (denominator 0). */
export function idleBuckets(counts: Pick<EntityCounts, "denominator">): boolean[] {
  return counts.denominator.map((d) => d === 0);
}

/** Per-bucket cache hit rate in percent; a bucket with no cache traffic counts as 0 — the curve runs continuously instead of leaving gaps. */
export function hitRateValues(series: UsageSeriesPoint[]): number[] {
  return series.map((p) => (cacheHitRate(p.cacheRead, p.cacheWrite) ?? 0) * 100);
}
