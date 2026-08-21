/**
 * Pure helpers behind the cost center's global controls (date-range presets +
 * time-series precision) and series shaping — no React, unit-tested in
 * test/usage-controls.test.ts.
 *
 * The range and the precision constrain each other, per preset: the trailing
 * "last hour" window is the only way to reach minute buckets (a calendar range
 * cannot — a single day by minute is already 1440 points), "last 24 hours"
 * serves hours, and the calendar presets offer the precisions that keep their
 * point counts readable. When a range change invalidates the current
 * precision, the page snaps to the preset's default rather than sending an
 * invalid combination.
 */
import type {
  UsageAgentSeries,
  UsageGranularity,
  UsageSeriesPoint,
} from "@prismshadow/penguin-server/api";
import { cacheHitRate } from "../../lib/format";

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

/** One drawable series of the requests chart's stacked bars: an entity's per-bucket request counts, or the folded tail. */
export interface EntitySeries {
  label: string;
  requests: number[];
  /** The folded "everything else" series (drawn in neutral gray, after the named ones). */
  other?: boolean;
}

/**
 * Shape entity series for stacking: the top `max` entities keep their own bar
 * color (the palette has that many distinct, CVD-checked hues), the rest fold
 * into one neutral "other" series instead of cycling colors into ambiguity.
 * Input is already sorted by total requests descending (the server's contract).
 */
export function foldEntitySeries(
  entities: Array<{ label: string; requests: number[] }>,
  otherLabel: string,
  max = 4,
): EntitySeries[] {
  const named = entities.slice(0, max).map((s) => ({ label: s.label, requests: s.requests }));
  const rest = entities.slice(max);
  if (rest.length === 0) return named;
  if (rest.length === 1) {
    // A tail of one is not "other": name it (the color is still the neutral one — labels beat a mystery bucket).
    return [...named, { label: rest[0]!.label, requests: rest[0]!.requests, other: true }];
  }
  const requests = rest[0]!.requests.map((_, i) =>
    rest.reduce((s, r) => s + (r.requests[i] ?? 0), 0),
  );
  return [...named, { label: otherLabel, requests, other: true }];
}

/** Per-bucket success rate in percent from paired count arrays; an idle bucket (denominator 0) counts as 100 — the site-wide "no requests = nothing failed" convention, and it keeps the line continuous. */
export function rateSeries(counts: Pick<UsageAgentSeries, "completed" | "denominator">): number[] {
  return counts.denominator.map((d, i) => (d > 0 ? ((counts.completed[i] ?? 0) / d) * 100 : 100));
}

/** Per-bucket success rate in percent for the whole filtered series (same idle-bucket convention as rateSeries). */
export function successRateValues(series: UsageSeriesPoint[]): number[] {
  return series.map((p) => (p.denominator > 0 ? (p.completed / p.denominator) * 100 : 100));
}

/** Per-bucket cache hit rate in percent; a bucket with no cache traffic counts as 0 — the curve runs continuously instead of leaving gaps. */
export function hitRateValues(series: UsageSeriesPoint[]): number[] {
  return series.map((p) => (cacheHitRate(p.cacheRead, p.cacheWrite) ?? 0) * 100);
}
