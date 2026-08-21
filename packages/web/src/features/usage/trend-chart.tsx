/**
 * Cost trend chart (hand-drawn SVG, no chart library; a single accent color +
 * gray grid, desaturated in dark mode, no clashing red/green): a straight
 * polyline with a dot on every data point + a semi-transparent area layered
 * down to the baseline to reinforce the trend over time, with a hover vertical
 * line + whole-column hit area + bubble. The coordinate system / grid / hover
 * logic is chart-svg.tsx's ChartFrame (shared with the other usage charts).
 *
 * Canvas width = the container's measured pixels (1 unit = 1 pixel, see
 * chart-svg): the chart simply fills the container and never scrolls
 * horizontally. An unpriced or empty bucket reads as 0, not a dash.
 */
import { useState } from "react";
import type { UsageGranularity, UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import { formatMoney } from "../../lib/format";
import type { Currency } from "../../state/theme";
import { makeGeom, linePath, areaPath } from "./chart-geom";
import { ChartFrame, useChartWidth } from "./chart-svg";
import { bucketAxisLabel, bucketFullLabel } from "./usage-controls";

export function TrendChart({
  series,
  granularity,
  currency = "USD",
}: {
  series: UsageSeriesPoint[];
  granularity: UsageGranularity;
  currency?: Currency;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useChartWidth();

  const cost = series.map((p) => p.cost ?? 0);
  const max = Math.max(1e-9, ...cost);
  const geom = makeGeom(series.length, max, width);
  const buckets = series.map((p) => p.bucket);
  // Dots on every point read fine up to daily density; past that (hourly and
  // finer zero-filled series) they would fuse into a rope, so the line stands
  // alone and the hovered point still gets its dot.
  const everyDot = series.length <= 92;

  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={(v) => formatMoney(v, currency)}
          dates={buckets}
          fmtX={(b) => bucketAxisLabel(granularity, b)}
          hover={hover}
          onHover={setHover}
          bubble={(i) => {
            const p = series[i]!;
            return (
              <>
                <p className="text-gray-400">{bucketFullLabel(granularity, p.bucket)}</p>
                <p className="font-mono">{formatMoney(p.cost ?? 0, currency)}</p>
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
            {everyDot &&
              series.map((p, i) => (
                <circle
                  key={p.bucket}
                  cx={geom.x(i)}
                  cy={geom.y(cost[i] ?? 0)}
                  r={hover === i ? 4 : 2.5}
                  className="fill-current"
                  opacity={hover !== null && hover !== i ? 0.25 : 1}
                />
              ))}
            {!everyDot && hover !== null && (
              <circle
                cx={geom.x(hover)}
                cy={geom.y(cost[hover] ?? 0)}
                r={4}
                className="fill-current"
              />
            )}
          </g>
        </ChartFrame>
      )}
    </div>
  );
}
