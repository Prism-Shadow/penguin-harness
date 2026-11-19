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
 * counts for requests and leaves a gap in the cost curve. `breaks` marks where the axis
 * skipped an interval.
 */
import { useState } from "react";
import type { UsageGranularity, UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import {
  ChartArea,
  ChartFrame,
  ChartLine,
  ChartPoint,
  makeRangeGeom,
  plotPadLeft,
  useChartWidth,
  type ChartPaint,
} from "@prismshadow/penguin-ui";

import { S } from "../../lib/strings";
import { formatEstimatedCost, formatMoney } from "../../lib/format";
import type { Currency } from "../../state/theme";
import { bucketAxisLabel, bucketFullLabel, toolQuantityRows } from "../../lib/usage-controls";
import { Empty } from "./usage-charts";

/**
 * The cost line's paint: the chart's own ink (the frame's text colour) — one series with no
 * identity to tell apart, so it takes no palette slot.
 */
const COST_PAINT: ChartPaint = { ink: "" };

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
  const max = Math.max(1e-9, ...series.map((p) => p.costMax ?? p.cost ?? 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((fraction) => fraction * max);
  const tickLabel = (value: number) => formatMoney(value, currency);
  const geom = makeRangeGeom(series.length, 0, max, width, undefined, {
    padL: plotPadLeft(ticks.map(tickLabel)),
  });
  const buckets = series.map((p) => p.bucket);
  // Dots are drawn only where the cells are wide enough to hold them apart: a
  // 2.5px-radius dot needs roughly this much room or the row fuses into a rope
  // (61 minute buckets in a half-width card sit ~7px apart). Below that the
  // line stands alone and only the hovered point gets its dot.
  const everyDot = geom.step >= MIN_DOT_STEP;
  const segments: [number, number][][] = [];
  series.forEach((p, index) => {
    if (p.cost === null) return;
    if (index === 0 || series[index - 1]?.cost === null) segments.push([]);
    segments[segments.length - 1]!.push([geom.x(index), geom.y(p.cost)]);
  });

  return (
    <div ref={ref}>
      {width > 0 && (
        <ChartFrame
          geom={geom}
          fmtY={tickLabel}
          yTicks={ticks}
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
                <p className="font-mono">
                  {formatEstimatedCost(p, currency)}
                  {p.hasUncosted && <sup>*</sup>}
                </p>
                {toolQuantityRows(p.toolQuantities).map(({ unit, quantity }) => (
                  <p key={unit}>
                    {S.usage.toolUnits[unit]} · {quantity}
                  </p>
                ))}
              </>
            );
          }}
        >
          <g>
            {segments.map((points) => (
              <g key={points[0]![0]}>
                <ChartArea
                  points={points}
                  baseY={geom.y(0)}
                  paint={COST_PAINT}
                  strength={hover !== null ? 0.6 : 1}
                />
                <ChartLine points={points} paint={COST_PAINT} opacity={hover !== null ? 0.35 : 1} />
                {!everyDot && points.length === 1 && (
                  <ChartPoint cx={points[0]![0]} cy={points[0]![1]} paint={COST_PAINT} />
                )}
              </g>
            ))}
            {series.map(
              (p, i) =>
                p.costMax !== undefined &&
                p.cost !== null && (
                  <ChartLine
                    key={p.bucket}
                    points={[
                      [geom.x(i), geom.y(p.cost)],
                      [geom.x(i), geom.y(p.costMax)],
                    ]}
                    paint={COST_PAINT}
                    dash="2 2"
                  />
                ),
            )}
            {everyDot &&
              series.map(
                (p, i) =>
                  p.cost !== null && (
                    <ChartPoint
                      key={p.bucket}
                      cx={geom.x(i)}
                      cy={geom.y(cost[i] ?? 0)}
                      paint={COST_PAINT}
                      grow={hover === i}
                      opacity={hover !== null && hover !== i ? 0.25 : 1}
                    />
                  ),
              )}
            {!everyDot && hover !== null && series[hover]?.cost != null && (
              <ChartPoint
                cx={geom.x(hover)}
                cy={geom.y(cost[hover] ?? 0)}
                paint={COST_PAINT}
                grow
              />
            )}
          </g>
        </ChartFrame>
      )}
    </div>
  );
}
