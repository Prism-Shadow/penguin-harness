/**
 * The geometry the chart primitives draw with — the part of a chart's layout a theme reaches
 * through its tokens: how a line runs between its points (`--ui-chart-curve`) and how wide a
 * bar is in its band (`--ui-chart-bar-fill`). A plot's own layout (its padding and scales,
 * stacked segments, hit bands, the hover bubble) is the plot frame's (`chart-frame/chart-geom.ts`).
 */
import type { ChartCurve } from "../chart-style";

/** Path coordinates keep 2 decimal places: the path string stays short and readable, and is easy to assert on in unit tests. */
export const roundCoord = (v: number): number => Math.round(v * 100) / 100;
const rnd = roundCoord;

/**
 * A series' path through its points, drawn the way the theme's `--ui-chart-curve` says:
 * - `linear`: `M x0,y0 L x1,y1 …`, straight segments (identical to the original cost line);
 * - `step`: a level run from each point to halfway to the next, then a vertical jump — the
 *   value holds over its own cell, as a bar would;
 * - `smooth`: a cubic through every point (Catmull-Rom tangents), with each control point held
 *   between its segment's two values, so the curve never swings above a peak or below a
 *   trough the data does not have.
 */
export function curvePath(
  points: ReadonlyArray<readonly [number, number]>,
  curve: ChartCurve = "linear",
): string {
  if (points.length === 0) return "";
  if (curve === "step") {
    const parts = [`M${points[0]![0]},${points[0]![1]}`];
    for (let i = 1; i < points.length; i++) {
      const [x0] = points[i - 1]!;
      const [x1, y1] = points[i]!;
      const mid = rnd((x0 + x1) / 2);
      parts.push(`H${mid} V${y1} H${x1}`);
    }
    return parts.join(" ");
  }
  if (curve === "smooth" && points.length > 2) {
    const parts = [`M${points[0]![0]},${points[0]![1]}`];
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)]!;
      const p1 = points[i]!;
      const p2 = points[i + 1]!;
      const p3 = points[Math.min(points.length - 1, i + 2)]!;
      const lo = Math.min(p1[1], p2[1]);
      const hi = Math.max(p1[1], p2[1]);
      const clampY = (y: number) => Math.min(hi, Math.max(lo, y));
      const c1x = rnd(p1[0] + (p2[0] - p0[0]) / 6);
      const c1y = rnd(clampY(p1[1] + (p2[1] - p0[1]) / 6));
      const c2x = rnd(p2[0] - (p3[0] - p1[0]) / 6);
      const c2y = rnd(clampY(p2[1] - (p3[1] - p1[1]) / 6));
      parts.push(`C${c1x},${c1y} ${c2x},${c2y} ${p2[0]},${p2[1]}`);
    }
    return parts.join(" ");
  }
  return points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x},${y}`).join(" ");
}

/**
 * Ceiling on bar width (**real CSS pixels**, since 1 canvas unit = 1 pixel):
 * with few points the bars never balloon past this — the extra space goes to
 * bar spacing.
 */
export const BAR_W = 25;

/**
 * Bar width that always fits the container (**no horizontal scrolling**): the theme's
 * `--ui-chart-bar-fill` share of the cell width (60% by default) — leaving ≥ 40% as spacing so adjacent bars never touch —
 * capped at BAR_W (few points must not balloon into slabs) and floored at 1px:
 * a dense range at fine granularity degrades to hairlines, not to overlap
 * (only a degenerate sub-1.7px cell can make the 1px floor fill its cell).
 */
export function fitBarWidth(step: number, fill = 0.6): number {
  return Math.max(1, Math.min(BAR_W, Math.floor(step * fill)));
}
