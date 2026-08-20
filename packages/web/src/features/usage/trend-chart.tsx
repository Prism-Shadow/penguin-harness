/**
 * Cost trend chart (hand-drawn SVG, no chart library; a single accent color +
 * gray grid, desaturated in dark mode, no clashing red/green): a smooth
 * monotone-cubic line (see chart-geom's monotonePath — no overshoot past the
 * data) + a semi-transparent area layered down to the baseline to reinforce
 * the trend over time, with a hover vertical line + whole-column hit area +
 * bubble. The coordinate system / grid / hover logic is chart-svg.tsx's
 * ChartFrame (shared with the Token bar chart).
 *
 * Canvas width = the container's measured pixels (1 unit = 1 pixel, see
 * chart-svg): the chart simply fills the container and never scrolls
 * horizontally.
 */
import { useState } from "react";
import type { UsageGranularity, UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import { formatMoney } from "../../lib/format";
import type { Currency } from "../../state/theme";
import { makeGeom, monotonePath, monotoneAreaPath } from "./chart-geom";
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
                <p className="font-mono">{formatMoney(p.cost, currency)}</p>
              </>
            );
          }}
        >
          <g>
            {/* Area fill: the curve closes down to the baseline, low opacity reinforces the trend's sense of "volume" */}
            <path
              d={monotoneAreaPath(geom, cost)}
              className="fill-current"
              stroke="none"
              opacity={hover !== null ? 0.06 : 0.1}
            />
            <path
              d={monotonePath(geom, cost)}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              opacity={hover !== null ? 0.35 : 1}
            />
            {hover !== null && (
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
