/**
 * The chart primitives: the one place a theme's chart tokens (../chart-style.ts) become marks.
 *
 * Every chart — the cost center's requests, Token and cost charts, the token donut, the
 * sparklines, the ring gauges — draws its bars, lines, areas, points, arcs, grid and axis labels
 * through these, and the Trace timeline its lanes through TimelineBar (timeline-bar.tsx). A chart
 * decides WHAT to draw — where a mark sits, which series it belongs to, whether it is dimmed —
 * and never HOW: the width of a bar in its band, its corner radius, outline and fill opacity, a
 * line's width and curve, a point's size, the fill under a line and every colour come from the
 * active theme here. A source guard (chart-marks.test.ts, in this package and in the Web App)
 * holds the charts to that.
 *
 * Each primitive writes `data-part` (and `data-series` where a series index exists), so a theme
 * may still restyle a part in CSS — a dashed grid, square points (a point is a rect whose `rx`
 * is its radius, so `rx: 0` squares it), round joins.
 *
 * A mark's colour is a `ChartPaint`: a palette slot, one of the named roles (the reference line,
 * the Token kinds), or an `ink` — a Tailwind text class the mark paints with as currentColor,
 * for marks whose colour is a neutral or a state rather than an identity (the folded "rest"
 * series, the cost line, a near-limit ring).
 */
import type { CSSProperties, MouseEventHandler, ReactNode } from "react";
import { seriesStroke, useChartStyle } from "../chart-style";
import type { ChartStyle } from "../chart-style";
import { curvePath, fitBarWidth } from "./geom";

export type ChartPaint =
  /** Palette slot `series` (0-based; cycles past the last). */
  | { series: number }
  /** A named colour: the reference line, or one of the Token kinds. */
  | { role: "ref" | "cacheRead" | "cacheWrite" | "output" }
  /**
   * A Tailwind text class; the mark paints with currentColor. `swatch` is the same colour as a
   * background class, for its legend swatch.
   */
  | { ink: string; swatch?: string };

/** A paint resolved against the theme: a colour for `style`, or the ink class. */
export function resolvePaint(
  chart: ChartStyle,
  paint: ChartPaint,
): { color?: string; className: string } {
  if ("series" in paint) return { color: seriesStroke(chart, paint.series), className: "" };
  if ("role" in paint) return { color: chart[paint.role], className: "" };
  return { className: paint.ink };
}

/** `data-series` for a paint: the 1-based slot, like the tokens (none for a role or an ink). */
const seriesAttr = (paint: ChartPaint) =>
  "series" in paint ? { "data-series": paint.series + 1 } : {};

/** The width a bar takes in a band of `band` px: the theme's fill share, capped and floored. */
export function useBarWidth(band: number): number {
  return fitBarWidth(band, useChartStyle().barFill);
}

/** The path of a bar whose top two corners round by `r` (clamped to its size). */
export function barPath(x: number, y: number, w: number, h: number, radius: number): string | null {
  const r = Math.max(0, Math.min(radius, w / 2, h));
  if (r === 0) return null;
  const right = x + w;
  const bottom = y + h;
  return `M${x},${bottom} V${y + r} A${r},${r} 0 0 1 ${x + r},${y} H${right - r} A${r},${r} 0 0 1 ${right},${y + r} V${bottom} Z`;
}

/**
 * A bar, centred on `cx` in a band `band` px wide, from `y` down `height` px. Its width is the
 * theme's share of the band; a bar that tops its stack (`top`) rounds its top corners by the
 * theme's radius; its fill takes the theme's bar opacity, and an outline the theme's bar
 * stroke (in the bar's own colour unless the theme names one). `opacity` dims the whole mark
 * (a highlight fading the rest).
 */
export function ChartBar({
  cx,
  band,
  y,
  height,
  paint,
  top = true,
  opacity,
  className = "",
}: {
  cx: number;
  band: number;
  y: number;
  height: number;
  paint: ChartPaint;
  top?: boolean;
  opacity?: number;
  className?: string;
}) {
  const chart = useChartStyle();
  const width = fitBarWidth(band, chart.barFill);
  const x = cx - width / 2;
  const { color, className: ink } = resolvePaint(chart, paint);
  const outline =
    chart.barStroke > 0
      ? {
          stroke: chart.barStrokeColor === "series" ? "currentColor" : chart.barStrokeColor,
          strokeWidth: chart.barStroke,
        }
      : {};
  const common = {
    "data-part": "bar",
    ...seriesAttr(paint),
    className: `${ink} ${className}`.trim(),
    fill: "currentColor",
    ...(chart.barOpacity < 1 ? { fillOpacity: chart.barOpacity } : {}),
    ...outline,
    opacity,
    style: color !== undefined ? { color } : undefined,
  };
  const d = top ? barPath(x, y, width, height, chart.barRadius) : null;
  return d === null ? (
    <rect x={x} y={y} width={width} height={height} {...common} />
  ) : (
    <path d={d} {...common} />
  );
}

/**
 * A series line through `points`, in the theme's curve and line width (`scale` shrinks it for
 * a sparkline). `dash` is data, not decoration: it tells a line on the right-hand axis from the
 * bars it shares a colour with. `round` gives it round caps and joins (the sparklines).
 */
export function ChartLine({
  points,
  paint,
  scale = 1,
  dash,
  round = false,
  opacity,
  className = "",
}: {
  points: ReadonlyArray<readonly [number, number]>;
  paint: ChartPaint;
  scale?: number;
  dash?: string;
  round?: boolean;
  opacity?: number;
  className?: string;
}) {
  const chart = useChartStyle();
  const { color, className: ink } = resolvePaint(chart, paint);
  return (
    <path
      data-part="series"
      {...seriesAttr(paint)}
      d={curvePath(points, chart.curve)}
      fill="none"
      stroke="currentColor"
      strokeWidth={chart.lineWidth * scale}
      {...(dash !== undefined ? { strokeDasharray: dash } : {})}
      {...(round ? { strokeLinecap: "round" as const, strokeLinejoin: "round" as const } : {})}
      opacity={opacity}
      className={`${ink} ${className}`.trim() || undefined}
      style={color !== undefined ? { color } : undefined}
    />
  );
}

/**
 * The fill under a line: the line's path in the theme's curve, dropped to `baseY` and closed.
 * Its opacity is the theme's area opacity times `strength` (a chart dims it while a point is
 * singled out, or draws a sparkline's a little stronger).
 */
export function ChartArea({
  points,
  baseY,
  paint,
  strength = 1,
}: {
  points: ReadonlyArray<readonly [number, number]>;
  baseY: number;
  paint: ChartPaint;
  strength?: number;
}) {
  const chart = useChartStyle();
  if (points.length === 0) return null;
  const { color, className: ink } = resolvePaint(chart, paint);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return (
    <path
      data-part="area"
      {...seriesAttr(paint)}
      d={`${curvePath(points, chart.curve)} L${last[0]},${baseY} L${first[0]},${baseY} Z`}
      fill="currentColor"
      stroke="none"
      opacity={chart.areaOpacity * strength}
      className={ink || undefined}
      style={color !== undefined ? { color } : undefined}
    />
  );
}

/**
 * A data point at (cx, cy), at the theme's point radius (`scale` for a sparkline; `grow` for
 * the hovered one). Drawn as a rect whose corner radius is its radius — a circle — so a theme
 * can square it in CSS.
 */
export function ChartPoint({
  cx,
  cy,
  paint,
  scale = 1,
  grow = false,
  opacity,
}: {
  cx: number;
  cy: number;
  paint: ChartPaint;
  scale?: number;
  grow?: boolean;
  opacity?: number;
}) {
  const chart = useChartStyle();
  const { color, className: ink } = resolvePaint(chart, paint);
  const r = chart.pointRadius * scale + (grow ? 1.5 : 0);
  return (
    <rect
      data-part="point"
      {...seriesAttr(paint)}
      x={cx - r}
      y={cy - r}
      width={2 * r}
      height={2 * r}
      rx={r}
      fill="currentColor"
      opacity={opacity}
      className={ink || undefined}
      style={color !== undefined ? { color } : undefined}
    />
  );
}

/**
 * An arc of a ring (the token donut, a ring gauge): `length` px of the circumference from
 * `offset`, clockwise from twelve o'clock, `width` thick. A series arc takes its paint; the
 * ring's empty track is a `grid` part painted with an ink at `trackOpacity`. `round` gives the
 * arc round caps (a gauge's single arc that does not close the ring).
 */
export function ChartArc({
  cx,
  cy,
  r,
  width,
  paint,
  length,
  offset = 0,
  track = false,
  trackOpacity,
  round = false,
}: {
  cx: number;
  cy: number;
  r: number;
  width: number;
  paint: ChartPaint;
  /** Omitted for the whole ring. */
  length?: number;
  offset?: number;
  track?: boolean;
  trackOpacity?: number;
  round?: boolean;
}) {
  const chart = useChartStyle();
  const { color, className: ink } = resolvePaint(chart, paint);
  const circumference = 2 * Math.PI * r;
  return (
    <circle
      data-part={track ? "grid" : "series"}
      {...(track ? {} : seriesAttr(paint))}
      cx={cx}
      cy={cy}
      r={r}
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      {...(trackOpacity !== undefined ? { strokeOpacity: trackOpacity } : {})}
      {...(round ? { strokeLinecap: "round" as const } : {})}
      {...(length !== undefined
        ? {
            strokeDasharray: `${length} ${circumference}`,
            strokeDashoffset: offset,
            transform: `rotate(-90 ${cx} ${cy})`,
          }
        : {})}
      className={ink || undefined}
      style={color !== undefined ? { color } : undefined}
    />
  );
}

/** A horizontal grid line across the plot, in the theme's grid ink. */
export function ChartGrid({ x1, x2, y }: { x1: number; x2: number; y: number }) {
  return (
    <line
      data-part="grid"
      x1={x1}
      x2={x2}
      y1={y}
      y2={y}
      className="stroke-chart-grid"
      strokeWidth={1}
    />
  );
}

/** The vertical line under the pointer on a line chart: chrome, not data, so it has no part. */
export function ChartCursor({ x, y1, y2 }: { x: number; y1: number; y2: number }) {
  return <line x1={x} x2={x} y1={y1} y2={y2} className="stroke-line-emphasis" strokeWidth={1} />;
}

/** An axis label (a tick value or a date), in the axis ink at the chart's small size. */
export function ChartAxis({
  x,
  y,
  anchor,
  children,
}: {
  x: number;
  y: number;
  anchor: "start" | "middle" | "end";
  children: ReactNode;
}) {
  return (
    <text data-part="axis" x={x} y={y} textAnchor={anchor} className="fill-chart-axis" fontSize={9}>
      {children}
    </text>
  );
}

/**
 * The "//" on the x axis between two points that are not neighbours in time: two short slashes
 * centred on `x`, just across the baseline at `y`. Never hoverable.
 */
export function ChartAxisBreak({ x, y }: { x: number; y: number }) {
  return (
    <g data-part="axis" className="pointer-events-none stroke-chart-axis" strokeWidth={1}>
      {[-2, 2].map((dx) => {
        const cx = x + dx / 2;
        return <line key={dx} x1={cx - 2} y1={y + 3} x2={cx + 2} y2={y - 3} />;
      })}
    </g>
  );
}

/** A transparent hit area: pointer handling for a mark, never drawn. */
export function ChartHit({
  x,
  y,
  width,
  height,
  cursor = "crosshair",
  onMouseEnter,
  onMouseLeave,
}: {
  x: number;
  y: number;
  width: number;
  height: number;
  cursor?: "crosshair" | "pointer";
  onMouseEnter?: MouseEventHandler<SVGRectElement>;
  onMouseLeave?: MouseEventHandler<SVGRectElement>;
}) {
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill="transparent"
      className={cursor === "pointer" ? "cursor-pointer" : "cursor-crosshair"}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}

/**
 * The hit area of one bar (or one stacked segment): as wide as the bar the theme draws in that
 * band, so the pointer finds exactly the mark it sees.
 */
export function ChartBarHit({
  cx,
  band,
  y,
  height,
  onMouseEnter,
  onMouseLeave,
}: {
  cx: number;
  band: number;
  y: number;
  height: number;
  onMouseEnter?: MouseEventHandler<SVGRectElement>;
  onMouseLeave?: MouseEventHandler<SVGRectElement>;
}) {
  const width = useBarWidth(band);
  return (
    <ChartHit
      x={cx - width / 2}
      y={y}
      width={width}
      height={height}
      cursor="pointer"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    />
  );
}

/**
 * A swatch's shape: square / block a series (sharper or softer corners), chip a wider bar
 * swatch, dash / tick a line, long or short.
 */
export type ChartSwatchShape = "square" | "block" | "dash" | "tick" | "chip";

/** A legend or bubble swatch in a paint: a square for a bar series, a dash for a line. */
export function ChartSwatch({
  paint,
  shape = "square",
  className = "",
}: {
  paint: ChartPaint;
  shape?: ChartSwatchShape;
  className?: string;
}) {
  const chart = useChartStyle();
  const { color } = resolvePaint(chart, paint);
  const ink = "ink" in paint ? (paint.swatch ?? "") : "";
  const size =
    shape === "dash"
      ? "h-0.5 w-3 rounded-sm"
      : shape === "tick"
        ? "h-0.5 w-2 rounded-sm"
        : shape === "block"
          ? "h-2 w-2 rounded-sm"
          : shape === "chip"
            ? "h-2 w-3 rounded-sm"
            : "h-2 w-2 rounded-[2px]";
  const style: CSSProperties | undefined =
    color !== undefined ? { backgroundColor: color } : undefined;
  return (
    <span className={`inline-block shrink-0 ${size} ${ink} ${className}`.trim()} style={style} />
  );
}
