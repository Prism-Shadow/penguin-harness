/**
 * A scatter plot's two numeric axes: pure, no React (test/chart-scatter.test.ts). Both axes are
 * value axes laid out as the bar and line charts lay out theirs, in three to six round steps,
 * inside the plot frame's paddings (chart-geom's PAD_T / PAD_B, the left padding grown to the
 * widest y label) — but a point is not read from zero, so each axis runs from a round number at
 * or below the data's lowest value to one at or above its highest (niceDomain `zero: false`):
 * readings of 900 to 1,000 fill the plot instead of sitting in its top tenth. A `min` / `max` the
 * caller gives for the y axis still holds.
 *
 * The x axis is a number line, not columns: its first tick sits on the plot's left edge and its
 * last on the right, so the right padding leaves room for half the last label; labels thin to
 * every few when they would touch.
 */
import { PAD_B, PAD_R, PAD_T } from "../chart-frame/chart-geom";
import { niceDomain, tickLabels } from "../cartesian/cartesian-data";
import type { ValueDomain } from "../cartesian/cartesian-data";
import { AXIS_FONT, everyNth, labelStride, plotPadLeft, textWidth } from "../cartesian/plot-layout";

/** A tick on an axis: where it is, and its label. */
export interface AxisTick {
  value: number;
  text: string;
}

export interface NumericPlot {
  width: number;
  height: number;
  padL: number;
  padR: number;
  /** A value's place on each axis, px. */
  x: (v: number) => number;
  y: (v: number) => number;
  /** The x labels that print (thinned), and every y tick with its grid line. */
  xTicks: AxisTick[];
  yTicks: AxisTick[];
}

/** `v`'s distance from the domain's low end, scaled to `span` px (0 on a domain of no width). */
const along = (v: number, d: ValueDomain, span: number) =>
  d.max > d.min ? ((v - d.min) / (d.max - d.min)) * span : 0;

/** The plot for `xs` against `ys` at `width` × `height`; `min` / `max` bound the y axis. */
export function numericPlot({
  xs,
  ys,
  width,
  height,
  fmtX,
  fmtY,
  min,
  max,
}: {
  xs: readonly number[];
  ys: readonly number[];
  width: number;
  height: number;
  fmtX: (v: number) => string;
  fmtY: (v: number) => string;
  min?: number;
  max?: number;
}): NumericPlot {
  const xd = niceDomain([xs], { zero: false });
  const yd = niceDomain([ys], { min, max, zero: false });
  const xText = tickLabels(xd.ticks, fmtX);
  const yText = tickLabels(yd.ticks, fmtY);
  const padL = plotPadLeft(yText);
  const last = xText[xText.length - 1] ?? "";
  const padR = Math.max(PAD_R, Math.ceil(textWidth(last, AXIS_FONT) / 2) + 2);
  const innerW = Math.max(0, width - padL - padR);
  const innerH = Math.max(0, height - PAD_T - PAD_B);
  const gap = xd.ticks.length > 1 ? innerW / (xd.ticks.length - 1) : innerW;
  const shown = everyNth(xd.ticks.length, labelStride(xText, gap, AXIS_FONT));
  return {
    width,
    height,
    padL,
    padR,
    x: (v) => padL + along(v, xd, innerW),
    y: (v) => PAD_T + innerH - along(v, yd, innerH),
    xTicks: shown.map((i) => ({ value: xd.ticks[i]!, text: xText[i]! })),
    yTicks: yd.ticks.map((value, i) => ({ value, text: yText[i]! })),
  };
}
