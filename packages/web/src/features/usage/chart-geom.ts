/**
 * Geometry math for the cost center charts: pure functions, no React / no
 * JSX, easy to unit test (see test/usage-charts.test.ts). The two "last 30
 * days" charts (the daily Token bar's three-segment stack, the daily cost
 * line + area) share one coordinate system — canvas width, padding, the
 * x()/y() mapping, SVG paths, x-axis label indices. The stacked bar's
 * horizontal layout (fixed 25px bar width, spacing ≥ bar width) is computed
 * by tokenBarLayout, and per-segment geometry (including per-segment hit
 * bands) is produced by barSegments; there's also pie-slice geometry (each
 * Agent's call count), success-rate normalization, and hover-bubble
 * placement (pointer lower-right, flipping at the edges). See chart-svg.tsx for the render skeleton.
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

/** A chart's coordinate system: canvas width w, data point count n, y-axis upper bound max, and x()/y() mapping "index / value" to canvas coordinates. */
export interface ChartGeom {
  n: number;
  max: number;
  /** Total canvas width (= viewBox width = CSS pixel width). */
  w: number;
  innerW: number;
  innerH: number;
  step: number;
  x: (i: number) => number;
  y: (v: number) => number;
}

/**
 * Build the coordinate system: x takes each cell's midpoint, y runs
 * top-to-bottom with max as the full height. w is the canvas width (pixels).
 * When `max <= 0` (no data / all zero), y always takes the baseline —
 * callers already guarantee max > 0, but this is an exported public pure
 * function, and without this guard a single 0 would turn the entire chart's coordinates into NaN / Infinity.
 */
export function makeGeom(n: number, max: number, w: number): ChartGeom {
  const innerW = Math.max(0, w - PAD_L - PAD_R);
  const innerH = CHART_H - PAD_T - PAD_B;
  const step = n > 0 ? innerW / n : innerW;
  return {
    n,
    max,
    w,
    innerW,
    innerH,
    step,
    x: (i) => PAD_L + step * i + step / 2,
    y: (v) => PAD_T + innerH * (1 - (max > 0 ? v / max : 0)),
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
 * Bar width (**real CSS pixels**, since 1 canvas unit = 1 pixel): **a fixed
 * value, not a minimum** — it used to be implemented as "no less than 25px",
 * which made bars stretch to fill the container when there were few points
 * (3 daily points could balloon to ~180px), defeating the intent of "25px
 * bar width". Now it's always 25px: scroll when it doesn't fit, and give the extra space to bar spacing when it does.
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

/** The Token bar chart's horizontal layout: bar width (always BAR_W), total canvas width, and whether the content overflows the container (needing horizontal scroll). */
export interface TokenBarLayout {
  /** Bar width (CSS pixels): always BAR_W. */
  barW: number;
  /** Total canvas width (CSS pixels): fills the container, or overflows it per "bar + equal spacing". */
  chartW: number;
  /** Canvas is wider than the container: the caller needs horizontal scrolling to see it all. */
  scroll: boolean;
}

/**
 * Token bar chart horizontal layout: **bar width is always BAR_W (25 real
 * pixels), bar spacing ≥ bar width**.
 * - Many points (n×2×25px doesn't fit): each cell is exactly 2× the bar
 *   width, and the canvas overflows the container in real pixels →
 *   the container scrolls horizontally (no scaling, no squeezing);
 * - Few points (fits): the canvas fills the container, and **all the extra
 *   space goes to bar spacing** — bars no longer stretch (the old
 *   implementation treated 25px as a floor, letting 3 daily points' bars
 *   balloon to ~180px), they just stand farther apart.
 */
export function tokenBarLayout(containerW: number, n: number): TokenBarLayout {
  const innerW = Math.max(0, containerW - PAD_L - PAD_R);
  const needed = 2 * BAR_W * n; // inner width needed to lay out n bars (bar + equal spacing)
  if (needed <= innerW) return { barW: BAR_W, chartW: containerW, scroll: false };
  return { barW: BAR_W, chartW: PAD_L + needed + PAD_R, scroll: true };
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

// —— Each Agent's call count: pie chart ——

const TAU = Math.PI * 2;
/** Path coordinates keep 2 decimal places: the path string stays short and readable, and is easy to assert on in unit tests. */
const rnd = (v: number): number => Math.round(v * 100) / 100;

/** Take a point in polar coordinates: angle is measured from 12 o'clock, clockwise-positive (SVG's y-axis points down). */
function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  const a = angle - Math.PI / 2;
  return [rnd(cx + r * Math.cos(a)), rnd(cy + r * Math.sin(a))];
}

/** A single pie slice. */
export interface PieSlice {
  /** Index within the passed-in values (the caller uses this to look up name and color). */
  index: number;
  value: number;
  /** Fraction of the total [0,1]. */
  frac: number;
  /** Start/end angle (radians, clockwise from 12 o'clock). */
  start: number;
  end: number;
  /** The slice's path. */
  path: string;
}

/**
 * Slice path: `M center L start A radius … end Z`; sweep=1 means clockwise,
 * large-arc=1 when spanning more than a semicircle.
 * At 100% the start and end points coincide and the A command degrades into
 * "draws nothing" — split into two semicircular arcs to get a full circle.
 */
function slicePath(cx: number, cy: number, r: number, start: number, end: number): string {
  if (end - start >= TAU - 1e-9) {
    const [tx, ty] = polar(cx, cy, r, 0);
    const [bx, by] = polar(cx, cy, r, Math.PI);
    return `M${tx},${ty} A${r},${r} 0 1 1 ${bx},${by} A${r},${r} 0 1 1 ${tx},${ty} Z`;
  }
  const [x0, y0] = polar(cx, cy, r, start);
  const [x1, y1] = polar(cx, cy, r, end);
  const large = end - start > Math.PI ? 1 : 0;
  return `M${rnd(cx)},${rnd(cy)} L${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} Z`;
}

/**
 * Pie slices: laid out clockwise from 12 o'clock in the order passed in,
 * each slice's angle = that value's share of the total.
 * Non-positive values produce no slice (a 0-degree arc is a degenerate
 * path); when the total ≤ 0, returns empty (the caller falls back to an empty state).
 */
export function pieSlices(values: number[], cx: number, cy: number, r: number): PieSlice[] {
  const total = values.reduce((s, v) => s + Math.max(0, v), 0);
  if (total <= 0) return [];
  const slices: PieSlice[] = [];
  let start = 0;
  values.forEach((value, index) => {
    if (value <= 0) return;
    const frac = value / total;
    const end = start + frac * TAU;
    slices.push({ index, value, frac, start, end, path: slicePath(cx, cy, r, start, end) });
    start = end;
  });
  return slices;
}
