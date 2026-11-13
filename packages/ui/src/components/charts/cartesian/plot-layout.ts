/**
 * Where a basic cartesian chart's text and columns land: pure functions, no React
 * (test/cartesian-data.test.ts covers them with the data side).
 *
 * The charts draw at one canvas unit to the pixel, so their text has to fit by measure, not by
 * scaling. A label's width is estimated from its characters at the axis' size — a CJK or
 * full-width character is one em, any other a little over half — which is what a plot needs to
 * decide how much room to leave, never to place text exactly.
 *
 * - The left padding grows to the widest tick label, so a unit ("1,240 ms") is never cut off.
 * - A category label longer than a column can hold is shortened with an ellipsis, and the labels
 *   thin to every few columns when they would touch; the hover bubble still names the category
 *   in full. Categories with no names at all (readings with no times) print no axis, and the plot
 *   takes the band its labels would have had.
 * - The bare frame (a line with no grid or value axis: an hourly forecast) spreads its columns
 *   edge to edge with a margin for the end labels, and labels as many as fit.
 */
import { roundCoord } from "../marks/geom";
import { makeRangeGeom, PAD_B, PAD_L, PAD_R } from "../chart-frame/chart-geom";
import type { ChartGeom } from "../chart-frame/chart-geom";
import { tickLabels } from "./cartesian-data";
import type { ValueDomain } from "./cartesian-data";

/** The font size the axis labels are set at (ChartAxis), px. */
export const AXIS_FONT = 9;
/** The font size a value written beside its point is set at (ChartLabel), px. */
export const LABEL_FONT = 11;
/** The space a tick label keeps from the plot (ChartFrame sets it 6 px left of the grid). */
const TICK_GAP = 6;
/** The widest the tick labels may push the plot's left edge, px. */
const MAX_PAD_L = 120;
/** The least space between two labels on one axis, px. */
const LABEL_GAP = 8;
/** The widest a category label may print before it is shortened, px. */
const MAX_CATEGORY_LABEL = 96;
/** The room under a plot with no category labels: the lowest tick label's descent, px. */
const PAD_B_UNLABELLED = 6;

/** A character set one em wide: CJK, Hangul, kana and the full-width forms. */
const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;
/** Any other character's estimated width, in em (a figure or a capital at the axis' size). */
const NARROW_EM = 0.62;

/** The estimated width of `text` set at `fontSize` px. */
export function textWidth(text: string, fontSize: number): number {
  let em = 0;
  for (const ch of text) em += WIDE.test(ch) ? 1 : NARROW_EM;
  return em * fontSize;
}

/** `text`, shortened with an ellipsis until it fits `maxWidth` at `fontSize`. */
export function clipLabel(text: string, maxWidth: number, fontSize: number): string {
  if (textWidth(text, fontSize) <= maxWidth) return text;
  const chars = [...text];
  while (chars.length > 1 && textWidth(`${chars.join("")}…`, fontSize) > maxWidth) chars.pop();
  return `${chars.join("").trimEnd()}…`;
}

/** The plot's left padding: room for the widest tick label, never less than the frame's own. */
export function plotPadLeft(labels: readonly string[]): number {
  const widest = Math.max(0, ...labels.map((label) => textWidth(label, AXIS_FONT)));
  return Math.min(MAX_PAD_L, Math.max(PAD_L, Math.ceil(widest) + TICK_GAP + 4));
}

/**
 * How many columns apart the labels go so that none touch: one label's widest width plus the
 * gap, over the column width. Columns too narrow to measure label only the first.
 */
export function labelStride(labels: readonly string[], step: number, fontSize: number): number {
  if (labels.length === 0) return 1;
  if (!(step > 0)) return labels.length;
  const widest = Math.max(...labels.map((label) => textWidth(label, fontSize)));
  return Math.max(1, Math.ceil((widest + LABEL_GAP) / step));
}

/** Every `stride`-th index of `n`, from the first. */
export function everyNth(n: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i += Math.max(1, stride)) out.push(i);
  return out;
}

/**
 * The category labels as the x axis prints them, and which of them it prints. Each label is
 * centred under its column; `edge` is the room right of the last column (the plot's right
 * padding), which the last label must not run past.
 */
export function categoryAxis(
  labels: readonly string[],
  step: number,
  edge: number,
): { text: string[]; shown: number[] } {
  // A wide column lets its label run to the column's width; a narrow one still allows a short
  // phrase, and the labels thin out to make room for it.
  const room = Math.max(MAX_CATEGORY_LABEL, step - LABEL_GAP);
  const text = labels.map((label) => clipLabel(label, room, AXIS_FONT));
  const shown = everyNth(labels.length, labelStride(text, step, AXIS_FONT));
  const last = labels.length - 1;
  if (shown.includes(last)) {
    text[last] = clipLabel(labels[last]!, Math.min(room, 2 * edge + step), AXIS_FONT);
  }
  return { text, shown };
}

/** The margin the bare frame keeps at each end, so the end labels are not cut. */
export const BARE_SIDE = 16;

/**
 * The bare frame's columns across `width`: `x(i)` for each of `n` points (a lone point in the
 * middle), and the indices that carry labels — as many as fit, judged by the axis labels and, when
 * the chart writes its values over the points, by those as well. A caller drawing something under
 * the columns (a forecast's condition icons) places it with the same `x` and `labelled`.
 */
export function bareColumns(
  width: number,
  axisLabels: readonly string[],
  valueLabels: readonly string[] = [],
): { x: (i: number) => number; step: number; labelled: number[] } {
  const n = axisLabels.length;
  const span = Math.max(0, width - 2 * BARE_SIDE);
  const step = n > 1 ? span / (n - 1) : span;
  const x = (i: number) => roundCoord(n > 1 ? BARE_SIDE + i * step : BARE_SIDE + span / 2);
  const stride = Math.max(
    labelStride(axisLabels, step, AXIS_FONT),
    valueLabels.length > 0 ? labelStride(valueLabels, step, LABEL_FONT) : 1,
  );
  return { x, step, labelled: n > 1 ? everyNth(n, stride) : n === 1 ? [0] : [] };
}

/** A plot frame laid out for a value axis and a row of categories. */
export interface ValuePlot {
  geom: ChartGeom;
  /** The values the grid lines sit at. */
  ticks: number[];
  /** A tick's label (blank where it would repeat the one below). */
  tickText: (v: number) => string;
  /** The category labels as printed, and which are printed. */
  axis: { text: string[]; shown: number[] };
}

/**
 * The plot frame for `categories` (already in the words the axis prints) over `domain`, at
 * `width` × `height`: the left padding fits the tick labels, then the columns share what is left.
 * When no category has a name, the plot reaches down into the label band.
 */
export function valuePlot({
  categories,
  domain,
  width,
  height,
  fmtValue,
}: {
  categories: readonly string[];
  domain: ValueDomain;
  width: number;
  height: number;
  fmtValue: (v: number) => string;
}): ValuePlot {
  const labels = tickLabels(domain.ticks, fmtValue);
  const unlabelled = categories.every((category) => category === "");
  const geom = makeRangeGeom(categories.length, domain.min, domain.max, width, PAD_R, {
    h: height,
    padL: plotPadLeft(labels),
    padB: unlabelled ? PAD_B_UNLABELLED : PAD_B,
  });
  const byTick = new Map(domain.ticks.map((tick, i) => [tick, labels[i]!]));
  return {
    geom,
    ticks: domain.ticks,
    tickText: (v) => byTick.get(v) ?? fmtValue(v),
    axis: categoryAxis(categories, geom.step, geom.padR),
  };
}
