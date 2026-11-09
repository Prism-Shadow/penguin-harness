/**
 * The basic charts: a `chart` block — line, area, bar, pie, scatter, histogram or gauge — as the
 * grammar reads it (parseChart), the reading of a series a summary prints (seriesExtent), and the
 * text a surface without a renderer shows instead (chartMarkdown). One data model serves every
 * kind but the gauge: categories (or bin edges) × series, units on the axes. A gauge is one
 * metrics item, read and printed by metric.ts, so a lone reading and a tile of a metrics block are
 * the same thing.
 */
import {
  type CountRule,
  type Issues,
  type Obj,
  isObj,
  length,
  present,
  readArray,
  readBoolean,
  readEnum,
  readInstant,
  readNumber,
  readNumbers,
  readString,
  unknownFields,
} from "./fields.js";
import { metricLine, parseMetric } from "./metric.js";
import {
  A2UI_LIMITS,
  type A2uiChart,
  type A2uiChartKind,
  type A2uiChartSeries,
  type A2uiLang,
} from "./types.js";
import { formatNumber, formatValue } from "./widgets.js";

export const A2UI_CHART_KINDS: readonly A2uiChartKind[] = [
  "line",
  "area",
  "bar",
  "pie",
  "scatter",
  "histogram",
  "gauge",
];

const CHART_FIELDS = [
  "type",
  "kind",
  "title",
  "categories",
  "edges",
  "series",
  "xLabel",
  "yLabel",
  "xUnit",
  "yUnit",
  "stacked",
  "horizontal",
  "donut",
  "min",
  "max",
  "decimals",
  "item",
  "asOf",
] as const;
type ChartField = (typeof CHART_FIELDS)[number];
const SERIES_FIELDS = ["label", "values", "points"] as const;

const COMMON: readonly ChartField[] = ["type", "kind", "title", "asOf"];
const CARTESIAN: readonly ChartField[] = [
  ...COMMON,
  "categories",
  "series",
  "xLabel",
  "yLabel",
  "yUnit",
  "min",
  "max",
  "decimals",
];
const NUMERIC_X: readonly ChartField[] = [
  ...COMMON,
  "series",
  "xLabel",
  "yLabel",
  "xUnit",
  "yUnit",
  "min",
  "max",
  "decimals",
];

/** The fields each kind reads; any other chart field is ignored with a warning. */
const KIND_FIELDS: Record<A2uiChartKind, readonly ChartField[]> = {
  line: CARTESIAN,
  area: [...CARTESIAN, "stacked"],
  bar: [...CARTESIAN, "stacked", "horizontal"],
  pie: [...COMMON, "categories", "series", "yUnit", "decimals", "donut"],
  scatter: NUMERIC_X,
  histogram: [...NUMERIC_X, "edges"],
  gauge: [...COMMON, "item"],
};

/** Why a field does nothing on a kind, in the words of the warning. */
function ignoredReason(key: ChartField, kind: A2uiChartKind): string {
  if (kind === "gauge") {
    return "a gauge shows its `item`; put the reading, its range and its unit there";
  }
  if (
    kind === "pie" &&
    key !== "stacked" &&
    key !== "horizontal" &&
    key !== "item" &&
    key !== "edges"
  ) {
    return "a pie chart has no axes";
  }
  switch (key) {
    case "stacked":
      return "only bar and area charts stack";
    case "horizontal":
      return "only a bar chart lies on its side";
    case "donut":
      return "only a pie chart has a hole";
    case "item":
      return "only a gauge reads an item";
    case "edges":
      return "only a histogram has bin edges";
    case "categories":
      return kind === "scatter"
        ? "a scatter chart places `series[].points`"
        : "a histogram's bins come from `edges`";
    default:
      // xUnit on a line, area or bar chart: the only field left that a non-gauge kind can ignore.
      return "its x axis has labels, not numbers";
  }
}

const WORDS = {
  en: {
    colon: ": ",
    none: "no reading",
    points: (n: number) => `${n} ${n === 1 ? "point" : "points"}`,
    extent: (min: string, max: string, count: string) => ` (min ${min}, max ${max}, ${count})`,
    share: (pct: string) => ` (${pct})`,
  },
  zh: {
    colon: "：",
    none: "无读数",
    points: (n: number) => `${n} 个点`,
    extent: (min: string, max: string, count: string) => `（最低 ${min}，最高 ${max}，${count}）`,
    share: (pct: string) => `（${pct}）`,
  },
} as const;

/** Past this many categories or bins, the text prints one summary line per series instead of a row each. */
const MAX_ROWS = 20;

function readDecimals(is: Issues, obj: Obj): number | undefined {
  const decimals = readNumber(is, obj, "decimals", "");
  if (decimals === undefined || (Number.isInteger(decimals) && decimals >= 0 && decimals <= 3)) {
    return decimals;
  }
  is.error(
    "range_invalid",
    `\`decimals\` is ${decimals}; use a whole number from 0 to 3.`,
    "decimals",
  );
  return undefined;
}

/** The axis names, units, value range and decimals the kind reads, onto `spec`. */
function readScale(is: Issues, obj: Obj, reads: readonly ChartField[], spec: A2uiChart): void {
  for (const key of ["xLabel", "yLabel"] as const) {
    if (!reads.includes(key)) continue;
    const value = readString(is, obj, key, "", { max: A2UI_LIMITS.axisLabel });
    if (value !== undefined) spec[key] = value;
  }
  for (const key of ["xUnit", "yUnit"] as const) {
    if (!reads.includes(key)) continue;
    const value = readString(is, obj, key, "", { max: A2UI_LIMITS.unit });
    if (value !== undefined) spec[key] = value;
  }
  if (reads.includes("min")) {
    const min = readNumber(is, obj, "min", "");
    const max = readNumber(is, obj, "max", "");
    if (min !== undefined && max !== undefined && min >= max) {
      is.error(
        "range_invalid",
        `\`min\` ${min} is not below \`max\` ${max}; fix the range, or leave both out to fit the data.`,
        "min",
      );
    }
    if (min !== undefined) spec.min = min;
    if (max !== undefined) spec.max = max;
  }
  if (reads.includes("decimals")) {
    const decimals = readDecimals(is, obj);
    if (decimals !== undefined) spec.decimals = decimals;
  }
}

/** Category names: non-empty strings within the limit; with `unique`, no name twice (a pie's slices). */
function readCategories(
  is: Issues,
  obj: Obj,
  rule: CountRule,
  unique: boolean,
): string[] | undefined {
  const raw = readArray(is, obj, "categories", "", rule);
  if (raw === undefined) return undefined;
  const seen = new Map<string, number>();
  return raw.map((entry, i) => {
    const cp = `categories[${i}]`;
    if (typeof entry !== "string") {
      is.error("wrong_type", `\`${cp}\` must be a string.`, cp);
      return "";
    }
    if (entry.trim() === "") {
      is.error("empty_string", `\`${cp}\` is empty; name every category.`, cp);
      return entry;
    }
    const n = length(entry);
    if (n > A2UI_LIMITS.categoryLabel) {
      is.error(
        "too_long",
        `\`${cp}\` is ${n} characters; the limit is ${A2UI_LIMITS.categoryLabel}. Shorten it.`,
        cp,
      );
    }
    const first = seen.get(entry);
    if (unique && first !== undefined) {
      is.error(
        "duplicate_label",
        `\`${cp}\` repeats slice ${first + 1}'s name "${entry}"; name each slice once.`,
        cp,
      );
    } else {
      seen.set(entry, i);
    }
    return entry;
  });
}

/** The `series` array: 1–6 (warn > 4), or exactly one for a pie or a histogram. */
function readSeriesArray(is: Issues, obj: Obj, kind: A2uiChartKind): unknown[] | undefined {
  if (kind === "pie" || kind === "histogram") {
    if (Array.isArray(obj.series) && obj.series.length > 1) {
      is.error(
        "count_out_of_range",
        `\`series\` has ${obj.series.length} series; a ${kind} chart takes exactly one. ${kind === "pie" ? "Compare several with a bar chart." : "Draw one histogram per series."}`,
        "series",
      );
      return undefined;
    }
    return readArray(is, obj, "series", "", { min: 1, max: 1, what: "series" });
  }
  return readArray(is, obj, "series", "", {
    ...A2UI_LIMITS.chartSeries,
    warnCode: "chart_many_series",
    warnHint: "Keep the series that matter, or split the chart in two.",
    what: "series",
  });
}

function readPoints(is: Issues, item: Obj, sp: string): [number, number][] | undefined {
  const raw = readArray(is, item, "points", sp, {
    ...A2UI_LIMITS.scatterPoints,
    warnCode: "scatter_many_points",
    warnHint: "Sample the points, or draw the trend as a line chart.",
    what: "points",
  });
  if (raw === undefined) return undefined;
  const points: [number, number][] = [];
  raw.forEach((point, i) => {
    const [x, y] = Array.isArray(point) ? point : [];
    const finite = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
    if (Array.isArray(point) && point.length === 2 && finite(x) && finite(y)) {
      points.push([x, y]);
      return;
    }
    const pp = `${sp}.points[${i}]`;
    is.error("wrong_type", `\`${pp}\` must be [x, y]: two numbers.`, pp);
  });
  return points;
}

interface SeriesRule {
  kind: A2uiChartKind;
  /** How many values each series must have: the categories, or the bins. Undefined when those are unusable. */
  expected: number | undefined;
  stacked: boolean;
}

function readValues(
  is: Issues,
  item: Obj,
  sp: string,
  rule: SeriesRule,
): (number | null)[] | undefined {
  const { kind, expected } = rule;
  const count: CountRule = { min: 0, max: Number.POSITIVE_INFINITY, what: "values" };
  let values: (number | null)[] | undefined;
  if (kind === "pie" || kind === "histogram") {
    values = readNumbers(is, item, "values", sp, {
      ...count,
      atLeast: 0,
      rangeHint: kind === "pie" ? "a slice is at least 0" : "a count is at least 0",
    });
  } else if (rule.stacked) {
    values = readNumbers(is, item, "values", sp, {
      ...count,
      nulls: true,
      atLeast: 0,
      rangeHint:
        "a stacked chart adds its series up, so every value is at least 0 — remove `stacked` to show a negative one",
    });
  } else {
    values = readNumbers(is, item, "values", sp, { ...count, nulls: true });
  }
  if (values === undefined) return undefined;
  const vp = `${sp}.values`;
  if (expected !== undefined && values.length !== expected) {
    is.error(
      "length_mismatch",
      kind === "histogram"
        ? `\`${vp}\` has ${values.length} counts for ${expected} bins (${expected + 1} edges); give one count per bin.`
        : `\`${vp}\` has ${values.length} values for ${expected} categories; give one value per category${kind === "pie" ? "" : " (null where there is no reading)"}.`,
      vp,
    );
  }
  if (kind === "pie" && values.length > 0 && values.every((v) => v === 0)) {
    is.error(
      "range_invalid",
      `\`${vp}\` is all 0; a pie needs at least one slice above 0 — say it in prose instead.`,
      vp,
    );
  }
  return values;
}

function readSeries(is: Issues, obj: Obj, rule: SeriesRule): A2uiChartSeries[] | undefined {
  const raw = readSeriesArray(is, obj, rule.kind);
  if (raw === undefined) return undefined;
  const scatter = rule.kind === "scatter";
  const list: A2uiChartSeries[] = [];
  const labels = new Map<string, number>();
  raw.forEach((item, i) => {
    const sp = `series[${i}]`;
    if (!isObj(item)) {
      is.error(
        "wrong_type",
        `\`${sp}\` must be an object with a \`label\` and \`${scatter ? "points" : "values"}\`.`,
        sp,
      );
      return;
    }
    const label = readString(is, item, "label", sp, {
      required: true,
      max: A2UI_LIMITS.seriesLabel,
    });
    const other = scatter ? "values" : "points";
    if (present(item[other])) {
      is.warn(
        "ignored_field",
        `\`${sp}.${other}\` has no effect on a ${rule.kind} chart; ${scatter ? "give each point as [x, y] in `points`" : "give one value per category in `values`"}.`,
        `${sp}.${other}`,
      );
    }
    unknownFields(is, item, SERIES_FIELDS, sp, "a series");
    const points = scatter ? readPoints(is, item, sp) : undefined;
    const values = scatter ? undefined : readValues(is, item, sp, rule);
    if (label === undefined) return;
    const seen = labels.get(label);
    if (seen !== undefined) {
      is.error(
        "duplicate_label",
        `\`${sp}.label\` repeats series ${seen + 1}'s label "${label}"; labels must be unique.`,
        `${sp}.label`,
      );
    } else {
      labels.set(label, i);
    }
    const series: A2uiChartSeries = { label };
    if (values !== undefined) series.values = values;
    if (points !== undefined) series.points = points;
    list.push(series);
  });
  return list;
}

/** Strictly ascending bin edges; reports the first one that is not above its neighbour. */
function readEdges(is: Issues, obj: Obj): number[] | undefined {
  const edges = readNumbers(is, obj, "edges", "", { ...A2UI_LIMITS.edges, what: "edges" });
  if (edges === undefined || edges.some(Number.isNaN)) return edges;
  const i = edges.findIndex((edge, k) => k > 0 && !(edge > (edges[k - 1] ?? edge)));
  if (i > 0) {
    is.error(
      "range_invalid",
      `\`edges[${i}]\` ${edges[i]} is not above \`edges[${i - 1}]\` ${edges[i - 1]}; bin edges go strictly up, lowest first.`,
      `edges[${i}]`,
    );
  }
  return edges;
}

/** Reads one `chart` block. Undefined when a field the kind needs is unusable. */
export function parseChart(is: Issues, obj: Obj): A2uiChart | undefined {
  const kind = readEnum(is, obj, "kind", "", A2UI_CHART_KINDS);
  const title = readString(is, obj, "title", "", { max: A2UI_LIMITS.chartTitle });
  const asOf = readInstant(is, obj, "asOf", "");
  unknownFields(is, obj, CHART_FIELDS, "", "a chart");
  if (kind === undefined) return undefined;
  const reads = KIND_FIELDS[kind];
  for (const key of CHART_FIELDS) {
    if (!present(obj[key]) || reads.includes(key)) continue;
    is.warn(
      "ignored_field",
      `\`${key}\` has no effect on a ${kind} chart (${ignoredReason(key, kind)}); remove it.`,
      key,
    );
  }
  const spec: A2uiChart = { type: "chart", kind };
  if (title !== undefined) spec.title = title;
  if (asOf !== undefined) spec.asOf = asOf;

  if (kind === "gauge") {
    if (!present(obj.item)) {
      is.error(
        "missing_field",
        '`item` is required for a gauge chart: one metrics item, such as {"label": "CPU", "value": 37, "max": 100, "unit": "%"}.',
        "item",
      );
      return undefined;
    }
    const item = parseMetric(is, obj.item, "item");
    if (item === undefined) return undefined;
    spec.item = item;
    return spec;
  }

  const stacked = reads.includes("stacked") ? readBoolean(is, obj, "stacked", "") : undefined;
  const horizontal = reads.includes("horizontal")
    ? readBoolean(is, obj, "horizontal", "")
    : undefined;
  const donut = reads.includes("donut") ? readBoolean(is, obj, "donut", "") : undefined;
  let categories: string[] | undefined;
  let edges: number[] | undefined;
  let expected: number | undefined;
  if (kind === "histogram") {
    edges = readEdges(is, obj);
    if (edges !== undefined) expected = edges.length - 1;
  } else if (kind !== "scatter") {
    categories =
      kind === "pie"
        ? readCategories(
            is,
            obj,
            {
              ...A2UI_LIMITS.pieSlices,
              warnCode: "pie_many_slices",
              warnHint: 'Merge the small slices into one "Other" slice.',
              what: "slices",
            },
            true,
          )
        : readCategories(
            is,
            obj,
            {
              ...A2UI_LIMITS.chartCategories,
              warnCode: "chart_many_categories",
              warnHint: "Group them (weeks instead of days), or keep the recent ones.",
              what: "categories",
            },
            false,
          );
    expected = categories?.length;
  }
  const series = readSeries(is, obj, { kind, expected, stacked: stacked === true });
  readScale(is, obj, reads, spec);
  if (series === undefined) return undefined;
  if (kind === "histogram" ? edges === undefined : kind !== "scatter" && categories === undefined) {
    return undefined;
  }
  if (categories !== undefined) spec.categories = categories;
  if (edges !== undefined) spec.edges = edges;
  spec.series = series;
  if (stacked !== undefined) spec.stacked = stacked;
  if (horizontal !== undefined) spec.horizontal = horizontal;
  if (donut !== undefined) spec.donut = donut;
  return spec;
}

/** The readings of a list, nulls skipped: the smallest, the largest, the first, the last and how many. */
export interface A2uiExtent {
  min: number;
  max: number;
  first: number;
  last: number;
  count: number;
}

/** The extent of the readings in `values` (nulls are gaps); undefined when there is none. */
export function seriesExtent(values: readonly (number | null)[]): A2uiExtent | undefined {
  let extent: A2uiExtent | undefined;
  for (const value of values) {
    if (value === null) continue;
    if (extent === undefined) {
      extent = { min: value, max: value, first: value, last: value, count: 1 };
      continue;
    }
    extent.min = Math.min(extent.min, value);
    extent.max = Math.max(extent.max, value);
    extent.last = value;
    extent.count += 1;
  }
  return extent;
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

/** One row per category or bin: the series' values side by side, named when there are several. */
function rowLines(spec: A2uiChart, rows: readonly string[], lang: A2uiLang): string[] {
  const t = WORDS[lang];
  const series = spec.series ?? [];
  return rows.map((row, r) => {
    const cells = series.map((s) => {
      const value = s.values?.[r];
      const text =
        value === null || value === undefined
          ? t.none
          : formatValue(value, spec.yUnit, lang, spec.decimals);
      return series.length === 1 ? text : `${s.label} ${text}`;
    });
    return `- ${row}${t.colon}${cells.join(" · ")}`;
  });
}

/** One line per series: first → last reading, then the range and the count. */
function summaryLines(spec: A2uiChart, lang: A2uiLang): string[] {
  const t = WORDS[lang];
  const value = (v: number, unit?: string) => formatValue(v, unit, lang, spec.decimals);
  return (spec.series ?? []).map((s) => {
    const extent = seriesExtent(s.values ?? []);
    if (extent === undefined) return `- ${s.label}${t.colon}${t.none}`;
    const trend = `${formatNumber(extent.first, lang, spec.decimals)} → ${value(extent.last, spec.yUnit)}`;
    return `- ${s.label}${t.colon}${trend}${t.extent(value(extent.min), value(extent.max), t.points(extent.count))}`;
  });
}

function pieLines(spec: A2uiChart, lang: A2uiLang): string[] {
  const t = WORDS[lang];
  const values = spec.series?.[0]?.values ?? [];
  const total = values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
  return (spec.categories ?? []).map((name, i) => {
    const v = values[i] ?? 0;
    const pct = total > 0 ? (v / total) * 100 : 0;
    const share = pct > 0 && pct < 0.5 ? "<1%" : `${formatNumber(Math.round(pct), lang)}%`;
    return `- ${name}${t.colon}${formatValue(v, spec.yUnit, lang, spec.decimals)}${t.share(share)}`;
  });
}

function scatterLines(spec: A2uiChart, lang: A2uiLang): string[] {
  const t = WORDS[lang];
  return (spec.series ?? []).map((s) => {
    const points = s.points ?? [];
    const x = seriesExtent(points.map((p) => p[0]));
    const y = seriesExtent(points.map((p) => p[1]));
    const parts = [t.points(points.length)];
    if (x !== undefined)
      parts.push(`${spec.xLabel ?? "x"} ${span(x.min, x.max, spec.xUnit, lang)}`);
    if (y !== undefined) {
      parts.push(`${spec.yLabel ?? "y"} ${span(y.min, y.max, spec.yUnit, lang, spec.decimals)}`);
    }
    return `- ${s.label}${t.colon}${parts.join(" · ")}`;
  });
}

/**
 * A valid chart as Markdown bullets under its bold title: a row per category or bin while there
 * are at most 20 (else a summary line per series), a slice with its share, a scatter series with
 * its extents, a gauge as its metrics item's line. The caller appends the "As of" foot.
 */
export function chartMarkdown(spec: A2uiChart, lang: A2uiLang): string[] {
  const out: string[] = [];
  if (spec.title) out.push(`**${spec.title}**`, "");
  switch (spec.kind) {
    case "gauge":
      if (spec.item !== undefined) out.push(metricLine(spec.item, lang));
      break;
    case "pie":
      out.push(...pieLines(spec, lang));
      break;
    case "scatter":
      out.push(...scatterLines(spec, lang));
      break;
    default: {
      const edges = spec.edges ?? [];
      const rows =
        spec.kind === "histogram"
          ? edges.slice(1).map((hi, i) => span(edges[i] ?? hi, hi, spec.xUnit, lang))
          : (spec.categories ?? []);
      out.push(...(rows.length > MAX_ROWS ? summaryLines(spec, lang) : rowLines(spec, rows, lang)));
    }
  }
  return out;
}
