/**
 * Session activity sparkline (Agents list card, GitHub-repo-Pulse-graph style): a
 * polyline + faint fill of daily active Session counts over the last N days,
 * normalized to the max value within the window — shows only relative ups and downs,
 * no scale/ticks. All-zero / empty data renders a flat baseline at the bottom. Drawn
 * through the chart primitives at a sparkline's scale, so it takes the theme's curve, line
 * width and area fill; its colour is its own ink, which follows light and dark.
 */
import { ChartArea, ChartLine, type ChartPaint } from "../../components/ui/chart";

/** The sparkline's paint: its own ink, the emerald the svg's text class sets. */
const INK: ChartPaint = { ink: "" };
/** Three quarters of the theme's line width (1.5px in the default theme). */
const LINE_SCALE = 0.75;
/** The fill under the line, a little stronger than a full chart's (0.12 in the default theme). */
const AREA_STRENGTH = 1.2;

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
  const baseline = [
    [PAD, H - PAD],
    [W - PAD, H - PAD],
  ] as const;
  const line = pts.length > 1 ? pts : baseline;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      data-tooltip={label}
      // ui-chart: a theme may redraw the line and the fill under it.
      className={`ui-chart text-emerald-600 dark:text-emerald-500 ${className}`}
    >
      {pts.length > 1 && (
        <ChartArea points={pts} baseY={H - PAD} paint={INK} strength={AREA_STRENGTH} />
      )}
      <ChartLine points={line} paint={INK} scale={LINE_SCALE} round />
    </svg>
  );
}
