/**
 * A chart block's data as the basic charts take it, and the words a screen reader hears in the
 * picture's place: pure functions over a validated `chart` spec, no React.
 *
 * - Series `i` paints in palette slot `i`, the same slot in the plot, the legend and the bubble.
 * - Every value prints with the values' unit and the block's decimals ("120 ms", "37%"), a
 *   scatter's x with its own unit, and a histogram's bins as "0–10 ms": the words the text
 *   fallback prints for the same block.
 * - A horizontal bar chart is rows on one scale. Grouped, each category has a bar per series, the
 *   category named on its first row, and a series with no reading there has no row. Stacked, each
 *   category is one row whose series sit end to end from zero, its total printed after it.
 * - The summary names the kind and the title, counts the categories and the series, then gives
 *   each series' range: "Bar chart: Latency. 5 categories, 2 series: p50 10–40 ms, p95 20–90 ms."
 */
import { formatNumber, formatValue, seriesExtent } from "@prismshadow/penguin-core/a2ui";
import type { A2uiChart, A2uiLang, A2uiMetric } from "@prismshadow/penguin-core/a2ui";
import type { A2uiStrings } from "../../../strings";
import { isReading, niceDomain } from "../../charts/cartesian/cartesian-data";
import type { CartesianSeries } from "../../charts/cartesian/cartesian-data";
import type { ChartPaint } from "../../charts/marks/marks";

/** The axes' names, as the cartesian charts take them. */
export interface ChartCaptions {
  x?: string;
  y?: string;
}

/** One row of a horizontal bar chart: one series' bar, or a category's stack of every series. */
export type HBarModelRow =
  | {
      kind: "bar";
      category: string;
      /** The first row of its category: the one that prints the category's name. */
      first: boolean;
      /** The series the bar belongs to, by index. */
      series: number;
      /** The bar runs from the scale's zero to the reading. */
      from: number;
      to: number;
      /** The reading in words. */
      value: string;
    }
  | {
      kind: "stack";
      category: string;
      /** One reading per series, in series order; null where a series has none. */
      stack: (number | null)[];
      /** The stack's total in words. */
      value: string;
    };

/** Which basic chart draws the block, with the props it takes from the spec. */
export type ChartModel =
  | {
      draw: "bar";
      categories: string[];
      series: CartesianSeries[];
      stacked: boolean;
      /** A histogram's bins: bars fill their column edge to edge. */
      flush: boolean;
      min?: number;
      max?: number;
      fmtValue: (v: number) => string;
      captions?: ChartCaptions;
    }
  | {
      draw: "hbar";
      rows: HBarModelRow[];
      min: number;
      max: number;
      /** The series: the legend's names, the bars' colours. */
      series: CartesianSeries[];
      /** A reading as a segment's bubble and words print it. */
      fmtValue: (v: number) => string;
    }
  | {
      draw: "line";
      categories: string[];
      series: CartesianSeries[];
      area: boolean;
      stacked: boolean;
      min?: number;
      max?: number;
      fmtValue: (v: number) => string;
      captions?: ChartCaptions;
    }
  | {
      draw: "pie";
      slices: { label: string; value: number; paint: ChartPaint }[];
      donut: boolean;
      fmtValue: (v: number) => string;
    }
  | {
      draw: "scatter";
      series: { label: string; points: [number, number][]; paint: ChartPaint }[];
      /** The y axis' bounds. */
      min?: number;
      max?: number;
      fmtX: (v: number) => string;
      fmtY: (v: number) => string;
      captions?: ChartCaptions;
    }
  /** A gauge is one metrics item; the grammar admits no gauge without one. */
  | { draw: "gauge"; metric: A2uiMetric | undefined };

const slot = (i: number): ChartPaint => ({ series: i });

/** The spec's series as the cartesian charts take them: values (nulls kept as gaps) in slot order. */
function cartesianSeries(spec: A2uiChart): CartesianSeries[] {
  return (spec.series ?? []).map((s, i) => ({
    label: s.label,
    values: s.values ?? [],
    paint: slot(i),
  }));
}

function captionsOf(spec: A2uiChart): ChartCaptions | undefined {
  if (spec.xLabel === undefined && spec.yLabel === undefined) return undefined;
  return {
    ...(spec.xLabel !== undefined ? { x: spec.xLabel } : {}),
    ...(spec.yLabel !== undefined ? { y: spec.yLabel } : {}),
  };
}

/** "0–10 ms", or the one value when the two ends meet. */
function span(
  min: number,
  max: number,
  unit: string | undefined,
  lang: A2uiLang,
  decimals?: number,
): string {
  if (min === max) return formatValue(min, unit, lang, decimals);
  return `${formatNumber(min, lang, decimals)}–${formatValue(max, unit, lang, decimals)}`;
}

/** A histogram's bins as the axis and the bubble name them: "0–10 ms". */
function binLabels(spec: A2uiChart, lang: A2uiLang): string[] {
  const edges = spec.edges ?? [];
  return edges.slice(1).map((hi, i) => span(edges[i] ?? hi, hi, spec.xUnit, lang));
}

/** A horizontal bar chart's rows and scale. */
function hbarModel(
  spec: A2uiChart,
  series: CartesianSeries[],
  fmtValue: (v: number) => string,
): Extract<ChartModel, { draw: "hbar" }> {
  const stacked = spec.stacked === true;
  const domain = niceDomain(
    series.map((s) => s.values),
    {
      ...(spec.min !== undefined ? { min: Math.min(spec.min, 0) } : {}),
      ...(spec.max !== undefined ? { max: Math.max(spec.max, 0) } : {}),
      stacked,
    },
  );
  const zero = Math.min(Math.max(0, domain.min), domain.max);
  const rows = (spec.categories ?? []).flatMap((category, c): HBarModelRow[] => {
    const readings = series.map((s) => s.values[c] ?? null);
    if (stacked) {
      const total = readings.reduce<number>((sum, v) => sum + (isReading(v) && v > 0 ? v : 0), 0);
      return [{ kind: "stack", category, stack: readings, value: fmtValue(total) }];
    }
    return readings
      .flatMap((v, i) => (isReading(v) ? [{ series: i, v }] : []))
      .map(({ series: i, v }, k): HBarModelRow => ({
        kind: "bar",
        category,
        first: k === 0,
        series: i,
        from: zero,
        to: v,
        value: fmtValue(v),
      }));
  });
  return { draw: "hbar", rows, min: domain.min, max: domain.max, series, fmtValue };
}

/** The basic chart a block draws, and what it draws it from. */
export function chartModel(spec: A2uiChart, lang: A2uiLang): ChartModel {
  const fmtValue = (v: number) => formatValue(v, spec.yUnit, lang, spec.decimals);
  const series = cartesianSeries(spec);
  const captions = captionsOf(spec);
  const bounds = {
    ...(spec.min !== undefined ? { min: spec.min } : {}),
    ...(spec.max !== undefined ? { max: spec.max } : {}),
  };
  const withCaptions = captions !== undefined ? { captions } : {};
  switch (spec.kind) {
    case "gauge":
      return { draw: "gauge", metric: spec.item };
    case "pie": {
      const values = spec.series?.[0]?.values ?? [];
      return {
        draw: "pie",
        slices: (spec.categories ?? []).map((label, i) => ({
          label,
          value: values[i] ?? 0,
          paint: slot(i),
        })),
        donut: spec.donut === true,
        fmtValue,
      };
    }
    case "scatter":
      return {
        draw: "scatter",
        series: (spec.series ?? []).map((s, i) => ({
          label: s.label,
          points: s.points ?? [],
          paint: slot(i),
        })),
        ...bounds,
        fmtX: (v) => formatValue(v, spec.xUnit, lang),
        fmtY: fmtValue,
        ...withCaptions,
      };
    case "histogram":
      return {
        draw: "bar",
        categories: binLabels(spec, lang),
        series,
        stacked: false,
        flush: true,
        ...bounds,
        fmtValue,
        ...withCaptions,
      };
    case "line":
    case "area":
      return {
        draw: "line",
        categories: spec.categories ?? [],
        series,
        area: spec.kind === "area",
        stacked: spec.kind === "area" && spec.stacked === true,
        ...bounds,
        fmtValue,
        ...withCaptions,
      };
    case "bar":
      if (spec.horizontal === true) return hbarModel(spec, series, fmtValue);
      return {
        draw: "bar",
        categories: spec.categories ?? [],
        series,
        stacked: spec.stacked === true,
        flush: false,
        ...bounds,
        fmtValue,
        ...withCaptions,
      };
  }
}

/** The summary's punctuation, in the block's language. */
const PUNCT = {
  en: { colon: ": ", stop: ".", gap: " ", comma: ", ", open: " (", close: ")" },
  zh: { colon: "：", stop: "。", gap: "", comma: "，", open: "（", close: "）" },
} as const;

/** A share of a whole as a whole percentage ("38%"), a sliver as "<1%". */
function sharePercent(value: number, total: number, lang: A2uiLang): string {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return pct > 0 && pct < 0.5 ? "<1%" : `${formatNumber(Math.round(pct), lang)}%`;
}

/**
 * What a screen reader hears for a chart: its kind and title, how many categories and series,
 * then each series' range (a slice's share, a scatter series' extents on both axes). A gauge is
 * a meter of its own and reads as its title or its reading's label.
 */
export function chartSummary(spec: A2uiChart, strings: A2uiStrings): string {
  const lang = strings.lang;
  const p = PUNCT[lang];
  const head =
    spec.title !== undefined
      ? `${strings.chartKind[spec.kind]}${p.colon}${spec.title}`
      : strings.chartKind[spec.kind];
  if (spec.kind === "gauge") return spec.title ?? spec.item?.label ?? head;
  const series = spec.series ?? [];
  const range = (values: readonly (number | null)[], unit: string | undefined) => {
    const extent = seriesExtent(values);
    return extent === undefined
      ? ""
      : ` ${span(extent.min, extent.max, unit, lang, spec.decimals)}`;
  };
  let counts: string[];
  let parts: string[];
  switch (spec.kind) {
    case "pie": {
      const values = series[0]?.values ?? [];
      const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
      const names = spec.categories ?? [];
      counts = [strings.categories(names.length)];
      parts = names.map((name, i) => `${name} ${sharePercent(values[i] ?? 0, total, lang)}`);
      break;
    }
    case "scatter":
      counts = [strings.seriesCount(series.length)];
      parts = series.map((s) => {
        const points = s.points ?? [];
        const x = range(
          points.map((pt) => pt[0]),
          spec.xUnit,
        );
        const y = range(
          points.map((pt) => pt[1]),
          spec.yUnit,
        );
        return `${s.label}${p.open}x${x}${p.comma}y${y}${p.close}`;
      });
      break;
    case "histogram": {
      const edges = spec.edges ?? [];
      counts = [strings.categories(Math.max(0, edges.length - 1))];
      const first = edges[0];
      const last = edges.at(-1);
      parts = [
        ...(first !== undefined && last !== undefined ? [span(first, last, spec.xUnit, lang)] : []),
        ...series.map((s) => `${s.label}${range(s.values ?? [], spec.yUnit)}`),
      ];
      break;
    }
    default:
      counts = [
        strings.categories((spec.categories ?? []).length),
        strings.seriesCount(series.length),
      ];
      parts = series.map((s) => `${s.label}${range(s.values ?? [], spec.yUnit)}`);
  }
  return `${head}${p.stop}${p.gap}${counts.join(p.comma)}${p.colon}${parts.join(p.comma)}${p.stop}`;
}
