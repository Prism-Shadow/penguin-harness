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
 * horizontally.
 *
 * The caller hands over a series whose empty buckets have already been
 * dropped (usage-controls' compactSeries), so the points sit left to right
 * over only the intervals that recorded something and the geometry spreads
 * them across the card. A bucket that ran but has no priced model still
 * counts: it reads as a cost of 0, not a dash. `breaks` marks where the axis
 * skipped an interval.
 */
import { useState } from "react";
import type { UsageGranularity, UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import { formatMoney } from "../../lib/format";
import type { Currency } from "../../state/theme";
import { makeGeom, linePath, areaPath } from "./chart-geom";
import { ChartFrame, DATA_STROKE_W, useChartWidth } from "./chart-svg";
import { bucketAxisLabel, bucketFullLabel } from "./usage-controls";
import { Empty } from "./usage-charts";

/** Cell width (CSS pixels) below which per-point dots stop being drawn: 2.5px radius plus breathing room. */
const MIN_DOT_STEP = 8;

export function TrendChart({
  series,
  granularity,
  currency = "USD",
  breaks,
}: {
  series: UsageSeriesPoint[];
  granularity: UsageGranularity;
  currency?: Currency;
  /** Indices after which the series skipped at least one empty bucket (see compactSeries): ChartFrame marks the axis there. */
  breaks?: number[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useChartWidth();
  // Nothing was recorded anywhere in the range: an empty grid would read as a
  // flat zero cost, so say there is nothing rather than draw nothing.
  if (series.length === 0) return <Empty />;

  const cost = series.map((p) => p.cost ?? 0);
  const max = Math.max(1e-9, ...cost);
  const geom = makeGeom(series.length, max, width);
  const buckets = series.map((p) => p.bucket);
  // Dots are drawn only where the cells are wide enough to hold them apart: a
  // 2.5px-radius dot needs roughly this much room or the row fuses into a rope
  // (61 minute buckets in a half-width card sit ~7px apart). Below that the
  // line stands alone and only the hovered point gets its dot.
  const everyDot = geom.step >= MIN_DOT_STEP;

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
          axisBreaks={breaks}
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
              strokeWidth={DATA_STROKE_W}
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
