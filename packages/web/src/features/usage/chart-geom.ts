/**
 * Geometry math for the cost center charts: pure functions, no React / no
 * JSX, easy to unit test (see test/usage-charts.test.ts). The time-series
 * charts (the requests + success-rate combo, the Token bar's three-segment
 * stack, the cost line) share one coordinate system — canvas width, padding,
 * the x()/y() mapping, SVG paths, x-axis label indices. Bars fit the
 * container (fitBarWidth — no horizontal scrolling), per-segment geometry
 * (including per-segment hit bands) is produced by barSegments, and the cache
 * hit rate's smooth curve comes from monotonePath (Fritsch–Carlson monotone
 * cubic: no overshoot, so a 0–100% rate stays bounded); there's also
 * success-rate normalization and hover-bubble placement (pointer lower-right,
 * flipping at the edges). See chart-svg.tsx for the render skeleton.
 *
 * **Canvas width = the container's measured pixel width (1 canvas unit = 1
 * CSS pixel)**: the SVG no longer stretches/scales via a fixed viewBox —
 * a scaled-down "bar width" would be a fake pixel discounted by the
 * container's width (640 units squeezed into a half-width cell becomes
 * ~495px, a 0.77 factor), while requirements like "at least 25px wide" must
 * land on **real display pixels**. So the canvas width is supplied by the caller after measuring the container.
 */

/** Canvas height and padding (carried over from the original TrendChart constants; width is now measured from the container, see the file header). */
export const CHART_H = 200;
export const PAD_L = 46;
export const PAD_R = 8;
export const PAD_T = 10;
export const PAD_B = 22;

/** The daily Token chart's three buckets (bottom-to-top stacking order is output → cacheWrite → cacheRead). */
export type TokenBucketKey = "cacheRead" | "cacheWrite" | "output";

/** Right padding for charts that carry a right-hand percentage axis (the Token chart's cache-hit-rate overlay): room for a "100%" tick label. */
export const PAD_R_AXIS = 34;

/** A chart's coordinate system: canvas width w, data point count n, y-axis bounds, and x()/y() mapping "index / value" to canvas coordinates. */
export interface ChartGeom {
  n: number;
  min: number;
  max: number;
  /** Total canvas width (= viewBox width = CSS pixel width). */
  w: number;
  /** Right padding (PAD_R by default; PAD_R_AXIS when a right-hand axis needs label room). */
  padR: number;
  innerW: number;
  innerH: number;
  step: number;
  x: (i: number) => number;
  y: (v: number) => number;
}

/**
 * Build the zero-baseline coordinate system: x takes each cell's midpoint,
 * y runs top-to-bottom with max as the full height, and w is the canvas width
 * in pixels. Invalid or zero-height ranges map values to the baseline rather
 * than producing NaN / Infinity.
 */
export function makeGeom(n: number, max: number, w: number, padR = PAD_R): ChartGeom {
  return makeRangeGeom(n, 0, max, w, padR);
}

/**
 * Build a coordinate system with an explicit y-axis range. Score charts use
 * this to zoom into the observed values; zero-baseline usage charts keep
 * calling makeGeom above. Geoms sharing n / w / padR share x() exactly — that
 * is how a right-axis overlay (its own y range) stays aligned with the marks
 * under it.
 */
export function makeRangeGeom(
  n: number,
  min: number,
  max: number,
  w: number,
  padR = PAD_R,
): ChartGeom {
  const innerW = Math.max(0, w - PAD_L - padR);
  const innerH = CHART_H - PAD_T - PAD_B;
  const step = n > 0 ? innerW / n : innerW;
  const range = max - min;
  return {
    n,
    min,
    max,
    w,
    padR,
    innerW,
    innerH,
    step,
    x: (i) => PAD_L + step * i + step / 2,
    y: (v) => PAD_T + innerH * (1 - (range > 0 ? (v - min) / range : 0)),
  };
}

/** Line path: `M x0,y0 L x1,y1 …` (identical to the original TrendChart's cost line). */
export function linePath(geom: ChartGeom, values: number[]): string {
  return values.map((v, i) => `${i === 0 ? "M" : "L"}${geom.x(i)},${geom.y(v)}`).join(" ");
}

/** Area path: the line drops vertically to the baseline (y=0) at the end, then closes back along the baseline to the start; used by the cost line's fill layer. */
export function areaPath(geom: ChartGeom, values: number[]): string {
  const n = values.length;
  if (n === 0) return "";
  const baseY = geom.y(0);
  const parts: string[] = [];
  for (let i = 0; i < n; i++)
    parts.push(`${i === 0 ? "M" : "L"}${geom.x(i)},${geom.y(values[i]!)}`);
  parts.push(`L${geom.x(n - 1)},${baseY}`);
  parts.push(`L${geom.x(0)},${baseY}`);
  parts.push("Z");
  return parts.join(" ");
}

// —— Smooth (monotone cubic) curves ——

/** Path coordinates keep 2 decimal places: the path string stays short and readable, and is easy to assert on in unit tests. */
const rnd = (v: number): number => Math.round(v * 100) / 100;

/**
 * Fritsch–Carlson tangents for a contiguous value run (uniform x spacing of 1
 * index): interior tangents average the neighbouring secants, flatten to 0 at
 * local extrema (a sign change), and are limited to 3× the segment's secant.
 * The limiter is what keeps every cubic segment inside its endpoints' value
 * range — a smoothed 100% success rate can never arc above 100%.
 */
function monotoneTangents(values: number[]): number[] {
  const n = values.length;
  const delta = values.slice(0, -1).map((v, i) => values[i + 1]! - v);
  const m = values.map((_, i) => {
    if (i === 0) return delta[0] ?? 0;
    if (i === n - 1) return delta[n - 2] ?? 0;
    const a = delta[i - 1]!;
    const b = delta[i]!;
    return a * b <= 0 ? 0 : (a + b) / 2;
  });
  for (let i = 0; i < n - 1; i++) {
    const d = delta[i]!;
    if (d === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i]! / d;
    const b = m[i + 1]! / d;
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d;
      m[i + 1] = t * b * d;
    }
  }
  return m;
}

/**
 * Smooth line path (monotone cubic interpolation, Fritsch–Carlson tangents):
 * `M` + cubic `C` segments, with the Hermite tangents converted to Bezier
 * control points at 1/3 of each segment. Never overshoots the data — every
 * cubic segment stays inside its two endpoints' value range, so a rate curve
 * bounded by 0–100 stays bounded after smoothing. Empty input returns an empty
 * string; a single point yields a bare `M` that strokes nothing.
 */
export function monotonePath(geom: ChartGeom, values: number[]): string {
  if (values.length === 0) return "";
  const m = monotoneTangents(values);
  const parts = [`M${rnd(geom.x(0))},${rnd(geom.y(values[0]!))}`];
  for (let i = 0; i < values.length - 1; i++) {
    const x0 = geom.x(i);
    const x1 = geom.x(i + 1);
    const dx = (x1 - x0) / 3;
    const c1v = values[i]! + m[i]! / 3;
    const c2v = values[i + 1]! - m[i + 1]! / 3;
    parts.push(
      `C${rnd(x0 + dx)},${rnd(geom.y(c1v))} ${rnd(x1 - dx)},${rnd(geom.y(c2v))} ${rnd(x1)},${rnd(
        geom.y(values[i + 1]!),
      )}`,
    );
  }
  return parts.join(" ");
}

/** Sparse x-axis label indices: first, middle, last (labeling every point would blur together when cells are narrow and there are many points). */
export function sparseLabelIdx(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  if (n === 2) return [0, 1];
  return [0, Math.floor((n - 1) / 2), n - 1];
}

/** Horizontal space a single date label (`MM-DD`, fontSize 9) takes up: roughly 28px of text width plus breathing room. */
const LABEL_MIN_PX = 40;

/**
 * Adaptive x-axis label indices: label more of them when each cell is wide
 * enough (the stride = the number of cells needed to fit the next label).
 * The Token bar chart's cells are each ≥ 2×25px, so in practice every day
 * gets labeled; when cells are narrow it automatically skips a few cells between labels so they don't blur together.
 */
export function autoLabelIdx(n: number, step: number): number[] {
  if (n <= 0) return [];
  const stride = step > 0 ? Math.max(1, Math.ceil(LABEL_MIN_PX / step)) : n;
  const idx: number[] = [];
  for (let i = 0; i < n; i += stride) idx.push(i);
  return idx;
}

/** Request success rate: no requests (total=0) is treated as 1 (matches the old bar's convention, avoiding 0/0). */
export function successRate(completed: number, total: number): number {
  return total > 0 ? completed / total : 1;
}

// —— Hover bubble placement (shared by both daily charts) ——

/** Gap between the pointer and the bubble's near corner: close enough to read as attached, far enough that the bubble never sits under the pointer. */
export const BUBBLE_OFFSET = 12;

/** The window the bubble must stay inside, in canvas coordinates: the scroll container's currently visible region (left/right move with horizontal scroll; the top is always 0). */
export interface BubbleView {
  left: number;
  right: number;
  bottom: number;
}

/**
 * Hover bubble placement: the preferred spot is the pointer's lower-right
 * (pointer + BUBBLE_OFFSET on both axes). Near an edge it **flips** to the
 * pointer's other side (right edge → lower-left, bottom edge → upper-right,
 * corner → upper-left): flipping keeps the bubble out from under the
 * pointer, where pure clamping would slide it back over the hovered mark.
 * The final clamp only guards the degenerate case (a window narrower than
 * the bubble on both sides of the pointer): the bubble then covers the
 * pointer, and a window narrower than the bubble itself still clips on the
 * right — unreachable at real card widths; the clamp just keeps the failure graceful.
 */
export function bubblePosition(
  px: number,
  py: number,
  bubbleW: number,
  bubbleH: number,
  view: BubbleView,
): { left: number; top: number } {
  let left = px + BUBBLE_OFFSET;
  if (left + bubbleW > view.right) left = px - BUBBLE_OFFSET - bubbleW;
  let top = py + BUBBLE_OFFSET;
  if (top + bubbleH > view.bottom) top = py - BUBBLE_OFFSET - bubbleH;
  return {
    left: Math.max(view.left, Math.min(left, view.right - bubbleW)),
    top: Math.max(0, Math.min(top, view.bottom - bubbleH)),
  };
}

// —— Daily Token: bar + three-segment stack ——

/**
 * Ceiling on bar width (**real CSS pixels**, since 1 canvas unit = 1 pixel):
 * with few points the bars never balloon past this — the extra space goes to
 * bar spacing.
 */
export const BAR_W = 25;

/**
 * Minimum height of the per-segment hover hit band (canvas units = pixels,
 * innerH=168): in real data, output is often under 1% of the day's total
 * (sub-pixel height), and if the hit area equaled the visual rectangle it
 * would be un-hoverable — highlighting down to "every segment" is this
 * chart's core requirement. Widening the bar (≥25px) doesn't help the
 * vertical dimension either: a sub-pixel value stays sub-pixel, so this
 * floor must be kept.
 * (The hit band's **width** is a separate matter: it spans the full cell horizontally, see TokenBarChart's hitLayer.)
 */
export const MIN_HIT_H = 8;

/**
 * Bar width that always fits the container (**no horizontal scrolling**): 60%
 * of the cell width — leaving ≥ 40% as spacing so adjacent bars never touch —
 * capped at BAR_W (few points must not balloon into slabs) and floored at 1px:
 * a dense range at fine granularity degrades to hairlines, not to overlap
 * (only a degenerate sub-1.7px cell can make the 1px floor fill its cell).
 */
export function fitBarWidth(step: number): number {
  return Math.max(1, Math.min(BAR_W, Math.floor(step * 0.6)));
}

/** One segment within a bar: the visual rectangle is drawn strictly to value, the hit band is computed separately (small segments are raised to be hoverable). */
export interface BarSegment {
  key: TokenBucketKey;
  value: number;
  /** Visual rectangle: segments sit flush against each other, total height = the day's total (no visual floor, no inflating the bar's height). */
  y: number;
  h: number;
  /** Hit band: fills the whole bar bottom-to-top with no overlap, small segments raised to minHit. */
  hitY: number;
  hitH: number;
}

/**
 * Hit-band height allocation (water-filling): segments below minHit are
 * raised to minHit, the rest share the remaining space proportionally to
 * their visual height; when the whole bar is shorter than k*minHit it
 * degrades to an even split (nobody can squeeze anybody else out).
 * Guarantee: the segment heights sum to total (the hit band fills the whole bar with no overlap).
 */
function hitHeights(heights: number[], total: number, minHit: number): number[] {
  const k = heights.length;
  if (k === 0) return [];
  if (total <= k * minHit) return heights.map(() => total / k);
  const small = new Set<number>();
  // Each round adds at most one segment to small; total > k*minHit guarantees not every segment gets added (some segment must end up with > minHit).
  for (;;) {
    const rest = total - small.size * minHit;
    const bigSum = heights.reduce((s, h, i) => (small.has(i) ? s : s + h), 0);
    const scaled = (i: number) =>
      bigSum > 0 ? (heights[i]! / bigSum) * rest : rest / (k - small.size);
    const next = heights.findIndex((_, i) => !small.has(i) && scaled(i) < minHit);
    if (next < 0) return heights.map((_, i) => (small.has(i) ? minHit : scaled(i)));
    small.add(next);
  }
}

/** Stacking order: bottom-to-top output → cacheWrite → cacheRead (matches TOKEN_COLORS' shading, darkest at the bottom). */
const STACK_ORDER: readonly TokenBucketKey[] = ["output", "cacheWrite", "cacheRead"];

/**
 * A bar's three-segment stack: bottom-to-top output → cacheWrite →
 * cacheRead, a zero-value bucket produces no segment (not drawn, and shouldn't be hoverable). The visual rectangle is drawn strictly to value; see hitHeights for the hit band.
 */
export function barSegments(
  geom: ChartGeom,
  p: { cacheRead: number; cacheWrite: number; output: number },
): BarSegment[] {
  const stack = STACK_ORDER.map((key) => ({ key, value: p[key] })).filter((b) => b.value > 0);
  if (stack.length === 0) return [];

  // Visual rectangles: the top edge is taken from the cumulative value, so segments sit flush against each other.
  const rects: Array<{ y: number; h: number }> = [];
  let cum = 0;
  for (const b of stack) {
    const bottom = geom.y(cum);
    cum += b.value;
    const top = geom.y(cum);
    rects.push({ y: top, h: bottom - top });
  }

  const base = geom.y(0);
  const hits = hitHeights(
    rects.map((r) => r.h),
    base - geom.y(cum),
    MIN_HIT_H,
  );
  let hitBottom = base;
  return stack.map((b, i) => {
    const hitH = hits[i]!;
    const seg: BarSegment = {
      key: b.key,
      value: b.value,
      y: rects[i]!.y,
      h: rects[i]!.h,
      hitY: hitBottom - hitH,
      hitH,
    };
    hitBottom -= hitH;
    return seg;
  });
}
