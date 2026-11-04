/**
 * The data side of the basic cartesian charts (bar, histogram, line, area): pure functions, no
 * React, so the value axis, the stacks and the gaps are tested directly
 * (test/cartesian-data.test.ts). Where marks land on the canvas is plot-layout.ts.
 *
 * - A value axis runs from zero to a round number at or above the data, in three to six equal
 *   round steps (`niceDomain`). A bound the caller gives is kept exactly, and is widened only when a
 *   value lies past it, so no mark is ever drawn off the plot. An axis whose marks are not read
 *   from zero (a scatter's) fits round numbers around the data alone instead (`zero: false`).
 * - A null value is no reading: a line breaks around it (`gapRuns`), a bar is simply absent, and
 *   a stack counts it as nothing.
 * - A stack adds the non-negative values bottom to top in series order (`stackLevels`).
 * - Series `i` paints in palette slot `i` unless it names a paint of its own (`seriesPaint`).
 * - Tick labels that print the same text (a 0.25 step at no decimals) say it once
 *   (`tickLabels`); their grid lines stay.
 */
import type { LinePoint } from "../chart-frame/chart-geom";
import type { ChartPaint } from "../marks/marks";

/** One series of a cartesian chart: a value per category. */
export interface CartesianSeries {
  label: string;
  /** One per category; `null` is no reading. */
  values: readonly (number | null)[];
  /** The series' colour; palette slot `i` (its position) when omitted. */
  paint?: ChartPaint;
}

/** A value axis: its bounds and the values its grid lines and tick labels sit at. */
export interface ValueDomain {
  min: number;
  max: number;
  /** Ascending, from `min` to `max` inclusive. */
  ticks: number[];
}

/** How many steps a value axis aims for between its bounds, and the fewest and most it takes. */
const TICK_STEPS = 4;
const MIN_STEPS = 3;
const MAX_STEPS = 6;
/** The multiples of a power of ten a step may be: 10, 20, 25, 50 — never 30 or 7. */
const NICE_MULTIPLES = [1, 2, 2.5, 5];

/** A value the chart can draw: a finite number (not null, not NaN). */
export const isReading = (v: number | null | undefined): v is number =>
  typeof v === "number" && Number.isFinite(v);

/** Float noise off a computed value (0.30000000000000004 → 0.3), and -0 as 0. */
const tidy = (v: number): number => Number(v.toPrecision(12)) + 0;

/** The series' paint: its own, or palette slot `i`. */
export function seriesPaint(series: Partial<CartesianSeries>, i: number): ChartPaint {
  return series.paint ?? { series: i };
}

/**
 * The round steps worth trying for a span that would split into steps of `raw`: 1, 2 and 5
 * times the powers of ten around it, and 2.5 times one from 25 up (a 2.5 step would tick a count
 * at 2.5, 7.5).
 */
function stepCandidates(raw: number): number[] {
  const power = Math.floor(Math.log10(raw));
  const out: number[] = [];
  for (let p = power - 1; p <= power + 1; p++) {
    for (const m of NICE_MULTIPLES) {
      if (m === 2.5 && p < 1) continue;
      out.push(tidy(m * 10 ** p));
    }
  }
  return out;
}

/** Each category's stack height: its series' non-negative readings added up. */
export function stackTotals(series: readonly (readonly (number | null)[])[]): number[] {
  const tops = stackLevels(series);
  return tops.length > 0 ? tops[tops.length - 1]! : [];
}

/**
 * The top of each series' layer in a stack, per category: series `s` sits on the layers below it,
 * and a null or negative reading adds nothing (its layer is flat on the one under it).
 */
export function stackLevels(series: readonly (readonly (number | null)[])[]): number[][] {
  const n = Math.max(0, ...series.map((values) => values.length));
  const levels: number[][] = [];
  let below = Array.from({ length: n }, () => 0);
  for (const values of series) {
    const level = below.map((base, i) => {
      const v = values[i];
      return tidy(base + (isReading(v) && v > 0 ? v : 0));
    });
    levels.push(level);
    below = level;
  }
  return levels;
}

/**
 * The value axis for `series`: zero to a round number above the data by default (and down to
 * one below it when a value is negative), in three to six round steps — of the round steps that
 * give that many, the one whose axis wastes the least room, then the one with fewer steps; a
 * stack is scaled by its totals. With `zero: false` the axis need not reach zero: it runs from a
 * round number at or below the lowest value to one at or above the highest, so readings of 900 to
 * 1,000 fill the plot rather than sitting in its top tenth (a single value has no extent of its
 * own, and keeps zero). `min` / `max` fix that bound exactly, unless a value lies past it: the
 * steps then run from the fixed bound.
 */
export function niceDomain(
  series: readonly (readonly (number | null)[])[],
  {
    min,
    max,
    stacked = false,
    zero = true,
  }: { min?: number; max?: number; stacked?: boolean; zero?: boolean } = {},
): ValueDomain {
  const values = (stacked ? [stackTotals(series)] : series).flatMap((s) => s.filter(isReading));
  const low = values.length > 0 ? Math.min(...values) : 0;
  const high = values.length > 0 ? Math.max(...values) : 0;
  const floor = zero || low === high ? 0 : low;
  const ceiling = zero || low === high ? 0 : high;
  let lo = Math.min(isReading(min) ? min : floor, low);
  let hi = Math.max(isReading(max) ? max : ceiling, high);
  const fixLo = isReading(min) && lo === min;
  let fixHi = isReading(max) && hi === max;
  if (hi <= lo) {
    if (fixHi && !fixLo) lo = hi - 1;
    else {
      hi = lo + 1;
      fixHi = false;
    }
  }
  if (fixLo && fixHi) {
    const ticks = Array.from({ length: TICK_STEPS + 1 }, (_, k) =>
      tidy(lo + ((hi - lo) * k) / TICK_STEPS),
    );
    return { min: lo, max: hi, ticks };
  }
  const fits = stepCandidates((hi - lo) / TICK_STEPS).map((step) => {
    const span = (from: number, to: number) => Math.ceil(tidy((to - from) / step)) * step;
    const a = fixLo ? lo : fixHi ? hi - span(lo, hi) : Math.floor(tidy(lo / step)) * step;
    const b = fixLo ? lo + span(lo, hi) : fixHi ? hi : Math.ceil(tidy(hi / step)) * step;
    return { step, lo: tidy(a), hi: tidy(b), count: Math.round((b - a) / step) };
  });
  const inRange = fits.filter((f) => f.count >= MIN_STEPS && f.count <= MAX_STEPS);
  const best =
    inRange.length > 0
      ? inRange.sort((x, y) => x.hi - x.lo - (y.hi - y.lo) || x.count - y.count)[0]!
      : fits.sort((x, y) => Math.abs(x.count - TICK_STEPS) - Math.abs(y.count - TICK_STEPS))[0]!;
  const ticks = Array.from({ length: best.count + 1 }, (_, k) => tidy(best.lo + k * best.step));
  return { min: best.lo, max: best.hi, ticks };
}

/**
 * The tick labels, one per tick: `fmt` of each, except that a label printing the same text as
 * the one below it is left blank — two "1"s on one axis read as a mistake.
 */
export function tickLabels(ticks: readonly number[], fmt: (v: number) => string): string[] {
  let previous: string | null = null;
  return ticks.map((v) => {
    const text = fmt(v);
    if (text === previous) return "";
    previous = text;
    return text;
  });
}

/**
 * A series' unbroken runs: consecutive readings, each with its category index. A null (or a
 * value that is not a finite number) ends a run, so a line drawn run by run breaks there.
 */
export function gapRuns(values: readonly (number | null)[]): LinePoint[][] {
  const runs: LinePoint[][] = [];
  let run: LinePoint[] = [];
  values.forEach((value, index) => {
    if (isReading(value)) run.push({ index, value });
    else if (run.length > 0) {
      runs.push(run);
      run = [];
    }
  });
  if (run.length > 0) runs.push(run);
  return runs;
}
