/**
 * Session activity sparkline (Agents list card, GitHub-repo-Pulse-graph style): a
 * polyline + faint fill of daily active Session counts over the last N days,
 * normalized to the max value within the window — shows only relative ups and downs,
 * no scale/ticks. All-zero / empty data renders a flat baseline at the bottom. Pure
 * SVG, no dependencies; color follows the light/dark theme.
 */

const W = 100;
const H = 30;
const PAD = 2;

export function ActivitySparkline({
  data,
  label,
  className = "",
}: {
  data: number[];
  label: string;
  className?: string;
}) {
  const max = Math.max(1, ...data);
  const step = data.length > 1 ? (W - 2 * PAD) / (data.length - 1) : 0;
  const pts = data.map((v, i) => [PAD + i * step, H - PAD - (v / max) * (H - 2 * PAD)] as const);
  const baseline = `${PAD},${H - PAD} ${W - PAD},${H - PAD}`;
  const line = pts.length > 1 ? pts.map(([x, y]) => `${x},${y}`).join(" ") : baseline;
  const area = pts.length > 1 ? `${line} ${W - PAD},${H - PAD} ${PAD},${H - PAD}` : null;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className={`text-emerald-600 dark:text-emerald-500 ${className}`}
    >
      <title>{label}</title>
      {area !== null && <polygon points={area} fill="currentColor" fillOpacity="0.12" />}
      <polyline
        points={line}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
