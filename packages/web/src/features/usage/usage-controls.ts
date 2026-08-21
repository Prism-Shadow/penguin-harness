/**
 * Pure helpers behind the cost center's global controls (date-range presets +
 * time-series precision) and the per-entity series shaping the requests charts
 * draw — no React, unit-tested in test/usage-controls.test.ts.
 *
 * The range and the precision constrain each other, per preset: the trailing
 * "last hour" window is the only way to reach minute buckets (a calendar range
 * cannot — a single day by minute is already 1440 points), "last 24 hours"
 * serves hours, and the calendar presets offer the precisions that keep their
 * point counts readable. When a range change invalidates the current
 * precision, the page snaps to the preset's default rather than sending an
 * invalid combination.
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

/**
 * Precisions worth offering for a custom calendar range: hourly only while the
 * range stays readable (≤ 14 days ⇒ ≤ 336 points), daily up to a year, weekly
 * once at least two weeks are in view, monthly once at least two months are.
 * Minute never appears here — only the trailing "last hour" preset reaches it.
 */
export function granularityOptions(days: number): UsageGranularity[] {
  const out: UsageGranularity[] = [];
  if (days <= 14) out.push("hour");
  if (days <= 366) out.push("day");
  if (days >= 14) out.push("week");
  if (days >= 60) out.push("month");
  return out;
}

/** The precision a custom range starts on: daily up to a month, weekly up to half a year, monthly beyond. */
export function defaultGranularity(days: number): UsageGranularity {
  if (days <= 92) return "day";
  if (days <= 190) return "week";
  return "month";
}

/** Precisions offered per preset (`days` only matters for `custom`). */
export function presetGranularities(preset: RangePreset, days: number): UsageGranularity[] {
  if (preset === "1h") return ["minute"];
  if (preset === "1d") return ["hour"];
  if (preset === "7d") return ["hour", "day"];
  if (preset === "30d" || preset === "90d") return ["day", "week"];
  return granularityOptions(days);
}

/** The precision a preset starts on. */
export function presetDefaultGranularity(preset: RangePreset, days: number): UsageGranularity {
  if (preset === "1h") return "minute";
  if (preset === "1d") return "hour";
  if (preset === "custom") return defaultGranularity(days);
  return "day";
}

/** Keep the user's precision when the new preset/range still offers it; otherwise snap to its default. */
export function coerceGranularity(
  g: UsageGranularity,
  preset: RangePreset,
  days: number,
): UsageGranularity {
  return presetGranularities(preset, days).includes(g) ? g : presetDefaultGranularity(preset, days);
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
 * Per-bucket success rate in percent, or null where the bucket holds no rated
 * request (denominator 0 — the entity was idle, or every request was
 * aborted). Null is a hole in the line, not a value: with one line per
 * entity, scoring an idle bucket 100% would draw a confident full-height line
 * across every interval an entity never ran in.
 */
export function rateSeries(
  counts: Pick<EntityCounts, "completed" | "denominator">,
): (number | null)[] {
  return counts.denominator.map((d, i) => (d > 0 ? ((counts.completed[i] ?? 0) / d) * 100 : null));
}

/** Per-bucket cache hit rate in percent; a bucket with no cache traffic counts as 0 — the curve runs continuously instead of leaving gaps. */
export function hitRateValues(series: UsageSeriesPoint[]): number[] {
  return series.map((p) => (cacheHitRate(p.cacheRead, p.cacheWrite) ?? 0) * 100);
}
