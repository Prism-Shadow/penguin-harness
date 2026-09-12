/**
 * Score sparkline of a Benchmark row: the scoreboard's Scores in order as one polyline, the
 * newest point marked. Normalized to the observed range with a small floor, so a series that
 * moved from 60 to 90 fills the box and a flat one draws a level line through its middle
 * instead of collapsing onto an edge; there are no ticks — the number beside it is the value.
 * A single score is a lone point. Pure SVG, its own geometry (outside the icon family).
 */
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
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className={`text-gray-500 dark:text-gray-400 ${className}`}
    >
      <title>{label}</title>
      {points.length > 1 && (
        <polyline
          points={points.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}
      {last !== undefined && <circle cx={last[0]} cy={last[1]} r={2} fill="currentColor" />}
    </svg>
  );
}
