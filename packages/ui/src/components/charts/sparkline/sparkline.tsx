/**
 * A sparkline: a series as one small line, with no axes and no ticks — the number beside it is
 * the value, the line only its ups and downs. Drawn through the chart primitives at a
 * sparkline's scale (three quarters of the theme's line width, four fifths of its point radius),
 * so it takes the theme's curve, line width and area fill; its colour is its own ink, the muted
 * one unless a tone is given.
 *
 * Two scales, for the two things a sparkline is asked:
 * - `zero` (the default): from zero to the largest value (at least 1), so the line shows how
 *   much against nothing — a count of sessions a day. Fewer than two values draw a flat baseline
 *   at the bottom.
 * - `range`: the observed range, at least `minSpan` wide and centred on the values, so a series
 *   that moved from 60 to 90 fills the box and a flat one draws a level line through its middle
 *   instead of collapsing onto an edge — a score. A single value is a lone point.
 *
 * `area` fills under the line (a little stronger than a full chart's fill); `marker` marks the
 * newest point.
 */
import { ChartArea, ChartLine, ChartPoint } from "../marks/marks";
import type { ChartPaint } from "../marks/marks";
import type { ToneName } from "../../../tokens";

/** The sparkline's paint: its own ink (a single series, no identity to tell apart). */
const INK: ChartPaint = { ink: "" };
/** A sparkline's scale of the theme's line width and point radius. */
const LINE_SCALE = 0.75;
const POINT_SCALE = 0.8;
/** The fill under the line, a little stronger than a full chart's. */
const AREA_STRENGTH = 1.2;
/** Room around the line for its stroke, and for the marked point's dot when there is one. */
const PAD = 2;
const MARKER_PAD = 2.5;

const TONE_INK: Record<ToneName, string> = {
  success: "text-tone-success-fg",
  attention: "text-tone-attention-fg",
  danger: "text-tone-danger-fg",
  done: "text-tone-done-fg",
  neutral: "text-tone-neutral-fg",
  info: "text-tone-info-fg",
};

export type SparklineScale = "zero" | "range";

/** The low end of the scale and its span, for `values` on `scale`. */
export function sparklineDomain(
  values: readonly number[],
  scale: SparklineScale,
  minSpan: number,
): { low: number; span: number } {
  if (scale === "zero") return { low: 0, span: Math.max(1, ...values) };
  if (values.length === 0) return { low: 0, span: minSpan };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, minSpan);
  return { low: (min + max) / 2 - span / 2, span };
}

export function Sparkline({
  values,
  label,
  scale = "zero",
  minSpan = 5,
  area = false,
  marker = false,
  width = 72,
  height = 22,
  tone,
  className = "",
}: {
  values: readonly number[];
  /** The accessible name and tooltip: what the line is of, since it draws no numbers. */
  label: string;
  scale?: SparklineScale;
  /** The smallest span a `range` scale stands for: below it, differences are noise at this size. */
  minSpan?: number;
  area?: boolean;
  marker?: boolean;
  width?: number;
  height?: number;
  /** The line's ink; the muted ink when omitted. */
  tone?: ToneName;
  /** Layout only (a size, a margin); the colour is the tone's. */
  className?: string;
}) {
  const pad = marker ? MARKER_PAD : PAD;
  const { low, span } = sparklineDomain(values, scale, minSpan);
  const step = values.length > 1 ? (width - 2 * pad) / (values.length - 1) : 0;
  const points = values.map(
    (v, i) => [pad + i * step, height - pad - ((v - low) / span) * (height - 2 * pad)] as const,
  );
  const baseline = [
    [pad, height - pad],
    [width - pad, height - pad],
  ] as const;
  const line = points.length > 1 ? points : scale === "zero" ? baseline : null;
  const last = points[points.length - 1];
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      data-tooltip={label}
      // ui-chart: a theme may redraw the line, the fill under it and the newest point its own way.
      className={`ui-chart ${tone === undefined ? "text-fg-muted" : TONE_INK[tone]} ${className}`}
    >
      {area && points.length > 1 && (
        <ChartArea points={points} baseY={height - pad} paint={INK} strength={AREA_STRENGTH} />
      )}
      {line !== null && <ChartLine points={line} paint={INK} scale={LINE_SCALE} round />}
      {marker && last !== undefined && (
        <ChartPoint cx={last[0]} cy={last[1]} paint={INK} scale={POINT_SCALE} />
      )}
    </svg>
  );
}
