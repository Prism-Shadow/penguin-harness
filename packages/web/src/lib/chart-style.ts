/**
 * How the active theme draws charts: the `--ui-chart-*` tokens, read off the root's computed
 * style, for the parts CSS cannot reach from outside an SVG's geometry — a bar's width and
 * corner radius, a line's width and curve, a point's radius, the fill under a line — and the
 * series palette those marks paint with.
 *
 * Components never ask which theme is active: they draw with this record. It is read once per
 * theme change, not per render: one MutationObserver on <html> (the attributes the theme
 * provider and the boot script write — class for the mode, data-theme, data-accent, and the
 * root font size in `style`) drops the cached record, and every chart subscribed through
 * `useChartStyle` re-renders with the new one.
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
  /** A series line's stroke width, px. */
  lineWidth: number;
  /** A data point's radius, px. */
  pointRadius: number;
  curve: ChartCurve;
  /** The fill under a line series, 0–1. */
  areaOpacity: number;
}

/**
 * What the charts draw with when no theme has answered (a document without the theme sheet,
 * server rendering in tests): the default theme's values, which are today's charts.
 */
export const DEFAULT_CHART_STYLE: ChartStyle = {
  series: ["#8b5cf6", "#f59e0b", "#0ea5e9", "#f43f5e", "#10b981", "#d946ef", "#64748b", "#14b8a6"],
  ref: "#f59e0b",
  cacheRead: "#7dd3fc",
  cacheWrite: "#0ea5e9",
  output: "#0369a1",
  barFill: 0.6,
  barRadius: 0,
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
 * style). Every value falls back to the default theme's on its own, so a theme that has not
 * defined a token yet draws the way the app always has.
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

let cached: ChartStyle | null = null;
const listeners = new Set<() => void>();
let observer: MutationObserver | null = null;

function snapshot(): ChartStyle {
  if (cached === null) {
    const computed = getComputedStyle(document.documentElement);
    cached = readChartStyle((name) => computed.getPropertyValue(name));
  }
  return cached;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (observer === null) {
    observer = new MutationObserver(() => {
      cached = null;
      for (const l of listeners) l();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme", "data-accent", "style"],
    });
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
