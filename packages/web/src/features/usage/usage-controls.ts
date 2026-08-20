/**
 * Pure helpers behind the cost center's global controls (date-range presets +
 * time-series precision) and series shaping — no React, unit-tested in
 * test/usage-controls.test.ts.
 *
 * The range and the precision constrain each other: hourly buckets are only
 * offered for short ranges (a 90-day hourly series would be 2160 points) and
 * weekly/monthly only once the range is long enough to fill more than a couple
 * of buckets. When a range change invalidates the current precision, the page
 * snaps to the range's default rather than sending an invalid combination.
 */
import type {
  UsageAgentSeries,
  UsageGranularity,
  UsageSeriesPoint,
} from "@prismshadow/penguin-server/api";
import { cacheHitRate } from "../../lib/format";

/** Quick range choices; `custom` reveals the two date inputs. */
export type RangePreset = "7d" | "30d" | "90d" | "custom";

/** Preset days (today inclusive). */
const PRESET_DAYS: Record<Exclude<RangePreset, "custom">, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Format a Date as a local `yyyy-mm-dd`. */
export function isoDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The from/to range a preset stands for (today inclusive). */
export function presetRange(
  preset: Exclude<RangePreset, "custom">,
  today: Date,
): { from: string; to: string } {
  const from = new Date(today);
  from.setDate(from.getDate() - (PRESET_DAYS[preset] - 1));
  return { from: isoDate(from), to: isoDate(today) };
}

/** Inclusive day count of a `yyyy-mm-dd` range (UTC arithmetic — plain calendar distance, no DST wobble); invalid or reversed ranges count as 1. */
export function rangeDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  if (!Number.isFinite(ms) || ms < 0) return 1;
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Precisions worth offering for a range: hourly only while the range stays
 * readable (≤ 14 days ⇒ ≤ 336 points), daily up to a year, weekly once at
 * least two weeks are in view, monthly once at least two months are.
 */
export function granularityOptions(days: number): UsageGranularity[] {
  const out: UsageGranularity[] = [];
  if (days <= 14) out.push("hour");
  if (days <= 366) out.push("day");
  if (days >= 14) out.push("week");
  if (days >= 60) out.push("month");
  return out;
}

/** The precision a range starts on: daily up to a month, weekly up to half a year, monthly beyond. */
export function defaultGranularity(days: number): UsageGranularity {
  if (days <= 92) return "day";
  if (days <= 190) return "week";
  return "month";
}

/** Keep the user's precision when the new range still offers it; otherwise snap to the range's default. */
export function coerceGranularity(g: UsageGranularity, days: number): UsageGranularity {
  return granularityOptions(days).includes(g) ? g : defaultGranularity(days);
}

/** Short x-axis form of a bucket key: hour `hh:00`, day/week `mm-dd`, month `yyyy-mm`. */
export function bucketAxisLabel(g: UsageGranularity, key: string): string {
  if (g === "hour") return key.slice(11);
  if (g === "month") return key;
  return key.slice(5);
}

/** Full bubble form of a bucket key: the key itself, with an hour's `T` opened up to a space. */
export function bucketFullLabel(g: UsageGranularity, key: string): string {
  return g === "hour" ? key.replace("T", " ") : key;
}

/** One drawable series of the calls chart: an Agent's per-bucket request counts, or the folded tail. */
export interface CallsSeries {
  label: string;
  values: number[];
  /** The folded "everything else" series (drawn in neutral gray, after the named ones). */
  other?: boolean;
}

/**
 * Shape the per-Agent series for drawing: the top `max` Agents keep their own
 * line (the palette has that many distinct, CVD-checked hues), the rest fold
 * into one neutral "other" series instead of cycling colors into ambiguity.
 * Input is already sorted by total requests descending (the server's contract).
 */
export function callsSeries(
  byAgent: UsageAgentSeries[],
  otherLabel: string,
  max = 4,
): CallsSeries[] {
  const named = byAgent.slice(0, max).map((s) => ({ label: s.agentId, values: s.requests }));
  const rest = byAgent.slice(max);
  if (rest.length === 0) return named;
  if (rest.length === 1) {
    // A tail of one is not "other": name it (the color is still the neutral one — labels beat a mystery bucket).
    return [...named, { label: rest[0]!.agentId, values: rest[0]!.requests, other: true }];
  }
  const values = rest[0]!.requests.map((_, i) =>
    rest.reduce((s, r) => s + (r.requests[i] ?? 0), 0),
  );
  return [...named, { label: otherLabel, values, other: true }];
}

/** Per-bucket success rate in percent; an idle bucket (denominator 0) counts as 100 — the site-wide "no requests = nothing failed" convention, and it keeps the line continuous. */
export function successRateValues(series: UsageSeriesPoint[]): number[] {
  return series.map((p) => (p.denominator > 0 ? (p.completed / p.denominator) * 100 : 100));
}

/** Per-bucket cache hit rate in percent; null (no cache traffic) leaves a gap rather than faking a 0. */
export function hitRateValues(series: UsageSeriesPoint[]): Array<number | null> {
  return series.map((p) => {
    const r = cacheHitRate(p.cacheRead, p.cacheWrite);
    return r === null ? null : r * 100;
  });
}
