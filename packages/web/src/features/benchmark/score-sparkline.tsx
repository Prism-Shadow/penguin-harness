/**
 * Score sparkline of a Benchmark row: the scoreboard's Scores in order as one polyline, the
 * newest point marked. Normalized to the observed range with a small floor, so a series that
 * moved from 60 to 90 fills the box and a flat one draws a level line through its middle
 * instead of collapsing onto an edge; there are no ticks — the number beside it is the value.
 * A single score is a lone point. Pure SVG, its own geometry (outside the icon family), drawn
 * in the theme's chart style at a sparkline's scale: three quarters of the line width and four
 * fifths of the point radius, and the theme's curve.
 */
import { useChartStyle } from "../../lib/chart-style";
import { curvePath } from "../usage/chart-geom";

const W = 72;
const H = 22;
const PAD = 2.5;
/** The smallest range the box stands for: below this, differences are noise at 72px wide. */
const MIN_SPAN = 5;

export function ScoreSparkline({
  values,
  label,
  className = "",
}: {
  values: readonly number[];
  label: string;
  className?: string;
}) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, MIN_SPAN);
  const low = (min + max) / 2 - span / 2;
  const step = values.length > 1 ? (W - 2 * PAD) / (values.length - 1) : 0;
  const points = values.map(
    (v, i) => [PAD + i * step, H - PAD - ((v - low) / span) * (H - 2 * PAD)] as const,
  );
  const last = points[points.length - 1];
  const chart = useChartStyle();
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      data-tooltip={label}
      // ui-chart: a theme may redraw the line and the newest point its own way.
      className={`ui-chart text-gray-500 dark:text-gray-400 ${className}`}
    >
      {points.length > 1 && (
        <path
          data-part="series"
          d={curvePath(points, chart.curve)}
          fill="none"
          stroke="currentColor"
          strokeWidth={chart.lineWidth * 0.75}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {last !== undefined && (
        <circle
          data-part="point"
          cx={last[0]}
          cy={last[1]}
          r={chart.pointRadius * 0.8}
          fill="currentColor"
        />
      )}
    </svg>
  );
}
