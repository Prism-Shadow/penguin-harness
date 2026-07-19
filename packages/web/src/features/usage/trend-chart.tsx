/**
 * Daily cost trend chart (hand-drawn SVG, no chart
 * library; a single accent color + gray grid, desaturated in dark mode, no
 * clashing red/green): a line + a semi-transparent area layered down to the
 * baseline to reinforce the trend over time, with a hover vertical line + whole-column hit area + bubble.
 * The coordinate system / grid / hover logic is extracted into chart-svg.tsx's ChartFrame (shared with the daily Token bar chart).
 *
 * Canvas width = the container's measured pixels (1 unit = 1 pixel, see
 * chart-svg): the line chart itself has no "minimum step" requirement, so it
 * simply fills the container and never scrolls horizontally — but once the
 * Token bar chart went full-width, this chart shares the same row, and if it
 * still stretched a fixed 640-unit viewBox, its height would get capped by max-h and centered with large empty margins on both sides.
 */
import { useState } from "react";
import type { UsageTrendPoint } from "@prismshadow/penguin-server/api";
import { formatMoney } from "../../lib/format";
import type { Currency } from "../../state/theme";
import { makeGeom, linePath, areaPath } from "./chart-geom";
import { ChartFrame, useChartWidth } from "./chart-svg";

export function TrendChart({
  points,
  currency = "USD",
}: {
  points: UsageTrendPoint[];
  currency?: Currency;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useChartWidth();

  const cost = points.map((p) => p.cost ?? 0);
  const max = Math.max(1e-9, ...cost);
  const geom = makeGeom(points.length, max, width);
  const dates = points.map((p) => p.date);

  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={(v) => formatMoney(v, currency)}
          dates={dates}
          hover={hover}
          onHover={setHover}
          bubble={(i) => {
            const p = points[i]!;
            return (
              <>
                <p className="text-gray-400">{p.date}</p>
                <p className="font-mono">{formatMoney(p.cost, currency)}</p>
              </>
            );
          }}
        >
          <g>
            {/* Area fill: the line closes down to the baseline, low opacity reinforces the trend's sense of "volume" */}
            <path
              d={areaPath(geom, cost)}
              className="fill-current"
              stroke="none"
              opacity={hover !== null ? 0.06 : 0.1}
            />
            <path
              d={linePath(geom, cost)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              opacity={hover !== null ? 0.35 : 1}
            />
            {points.map((p, i) => (
              <circle
                key={p.date}
                cx={geom.x(i)}
                cy={geom.y(p.cost ?? 0)}
                r={hover === i ? 4 : 2.5}
                className="fill-current"
                opacity={hover !== null && hover !== i ? 0.25 : 1}
              />
            ))}
          </g>
        </ChartFrame>
      )}
    </div>
  );
}
