/**
 * How the active theme draws charts: the `--ui-chart-*` tokens, read off the root's computed
 * style, for the parts CSS cannot reach from outside an SVG's geometry — a bar's width and
 * corner radius, a line's width and curve, a point's radius, the fill under a line — and the
 * series palette those marks paint with.
 *
 * Only the chart primitives (`marks/`) read it: every chart draws its marks through them, so a
 * token turns into geometry and colour in one place. Components never ask which theme is active.
 * It is read once per theme change, not per render: one MutationObserver on <html> — where the
 * theme provider and the boot script write the mode class, the theme, the accent and the root
 * font size — drops the cached record, and every chart subscribed through `useChartStyle`
 * re-renders with the new one. Reading the tokens is what tells a real change from any other
 * attribute write, so the observer watches every attribute and a read that finds nothing new
 * hands back the same record.
 *
 * Slots are identities, fixed across themes: 1 violet, 2 amber, 3 sky, 4 rose, 5 emerald,
 * 6 fuchsia, 7 and 8 spare — each theme picks its own shade of each. A chart's series take the
 * slots in order; the Trace timeline maps its kinds onto slots 1, 3, 2, 4, 5.
 */
import { useSyncExternalStore } from "react";

export type ChartCurve = "linear" | "smooth" | "step";

export interface ChartStyle {
  /** The categorical palette, slots 1–8 in order. */
  series: readonly string[];
  /** Reference lines drawn over a chart's own series (the cache-hit-rate curve). */
  ref: string;
  /** The token kinds' own colours (the stacked Token bars and the context donut). */
  cacheRead: string;
  cacheWrite: string;
  output: string;
  /** The share of its band a bar takes, 0–1. */
  barFill: number;
  /** A bar's top corner radius, px. */
  barRadius: number;
  /** A bar's outline width, px (0 = no outline). */
  barStroke: number;
  /** The outline's colour, or "series" for the bar's own colour. */
  barStrokeColor: string;
  /** A bar's fill opacity, 0–1. */
  barOpacity: number;
  /** A series line's stroke width, px. */
  lineWidth: number;
  /** A data point's radius, px. */
  pointRadius: number;
  curve: ChartCurve;
  /** The fill under a line series, 0–1. */
  areaOpacity: number;
}

/**
 * What the charts draw with before a theme has answered (server rendering in tests, a first
 * read with no stylesheet): the default theme's geometry, and colours that name the tokens
 * themselves, so a mark painted with one still takes the theme's value wherever the theme sheet
 * is loaded.
 */
export const DEFAULT_CHART_STYLE: ChartStyle = {
  series: [1, 2, 3, 4, 5, 6, 7, 8].map((slot) => `var(--ui-chart-${slot})`),
  ref: "var(--ui-chart-ref)",
  cacheRead: "var(--ui-chart-cache-read)",
  cacheWrite: "var(--ui-chart-cache-write)",
  output: "var(--ui-chart-output)",
  barFill: 0.6,
  barRadius: 0,
  barStroke: 0,
  barStrokeColor: "series",
  barOpacity: 1,
  lineWidth: 2,
  pointRadius: 2.5,
  curve: "linear",
  areaOpacity: 0.1,
};

/** A number token, or the fallback when it is missing or not a number. */
function numberOf(raw: string, fallback: number): number {
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}

/** A colour token, or the fallback when it is missing. */
function colourOf(raw: string, fallback: string): string {
  return raw.trim() === "" ? fallback : raw.trim();
}

/**
 * The record, from a reader of custom properties (`getPropertyValue` on the root's computed
 * style). Every value falls back to the default record's on its own, so a token a theme has not
 * defined yet draws the way the default theme does.
 */
export function readChartStyle(read: (name: string) => string): ChartStyle {
  const d = DEFAULT_CHART_STYLE;
  const curve = read("--ui-chart-curve").trim();
  return {
    series: d.series.map((fallback, i) => colourOf(read(`--ui-chart-${i + 1}`), fallback)),
    ref: colourOf(read("--ui-chart-ref"), d.ref),
    cacheRead: colourOf(read("--ui-chart-cache-read"), d.cacheRead),
    cacheWrite: colourOf(read("--ui-chart-cache-write"), d.cacheWrite),
    output: colourOf(read("--ui-chart-output"), d.output),
    barFill: Math.min(1, Math.max(0.05, numberOf(read("--ui-chart-bar-fill"), d.barFill))),
    barRadius: Math.max(0, numberOf(read("--ui-chart-bar-radius"), d.barRadius)),
    barStroke: Math.max(0, numberOf(read("--ui-chart-bar-stroke"), d.barStroke)),
    barStrokeColor: colourOf(read("--ui-chart-bar-stroke-color"), d.barStrokeColor),
    barOpacity: Math.min(1, Math.max(0, numberOf(read("--ui-chart-bar-opacity"), d.barOpacity))),
    lineWidth: Math.max(0.5, numberOf(read("--ui-chart-line-width"), d.lineWidth)),
    pointRadius: Math.max(0, numberOf(read("--ui-chart-point-radius"), d.pointRadius)),
    curve: curve === "smooth" || curve === "step" ? curve : "linear",
    areaOpacity: Math.min(1, Math.max(0, numberOf(read("--ui-chart-area-opacity"), d.areaOpacity))),
  };
}

/** Series colour `i`, cycling through the palette. */
export function seriesStroke(style: ChartStyle, i: number): string {
  return style.series[i % style.series.length]!;
}

/** Whether two records draw the same charts: every value equal, the palette slot by slot. */
export function sameChartStyle(a: ChartStyle, b: ChartStyle): boolean {
  for (const key of Object.keys(a) as Array<keyof ChartStyle>) {
    if (key === "series") continue;
    if (a[key] !== b[key]) return false;
  }
  return a.series.length === b.series.length && a.series.every((c, i) => c === b.series[i]);
}

/**
 * The next record to hand out: `previous` itself when nothing a chart draws with changed, so
 * a subscriber sees the same object and React re-renders nothing. <html> changes for many
 * reasons that are not the theme (the root font size, a frame writing its height, a class a
 * library toggles); a new object on each of those would re-render every chart, and a chart
 * whose render changes <html> again would never settle.
 */
export function nextChartStyle(previous: ChartStyle | null, read: ChartStyle): ChartStyle {
  return previous !== null && sameChartStyle(previous, read) ? previous : read;
}

let cached: ChartStyle | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

/** Reads the root's tokens. Reading never writes: no state, no attribute, no style. */
function readRoot(): ChartStyle {
  const computed = getComputedStyle(document.documentElement);
  return readChartStyle((name) => computed.getPropertyValue(name));
}

function snapshot(): ChartStyle {
  if (cached === null) cached = readRoot();
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (observer === null) {
    // No one watched <html> while there were no charts: catch up once, keeping the same
    // object when nothing changed in the meantime.
    if (cached !== null) cached = nextChartStyle(cached, readRoot());
    observer = new MutationObserver(() => {
      const next = nextChartStyle(cached, readRoot());
      // Only a real change reaches the charts.
      if (next === cached) return;
      cached = next;
      for (const l of listeners) l();
    });
    observer.observe(document.documentElement, { attributes: true });
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      observer?.disconnect();
      observer = null;
    }
  };
}

/** The active theme's chart style; charts re-render when the theme, mode or accent changes. */
export function useChartStyle(): ChartStyle {
  return useSyncExternalStore(subscribe, snapshot, () => DEFAULT_CHART_STYLE);
}
