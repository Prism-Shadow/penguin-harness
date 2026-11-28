/**
 * A rate line on a chart's right-hand 0–100% axis: the Requests charts' success rates and the
 * Token chart's cache hit rate. It is drawn only where there is a rate. Neighbouring rates are
 * joined by a stroke, a lone rate is a point, and a bucket with nothing to rate (or an axis
 * break) leaves the line open (rateRuns). The bubble prints a dash for such a bucket.
 */
import { ChartLine, ChartPoint, type ChartGeom, type ChartPaint } from "@prismshadow/penguin-ui";

import { rateRuns } from "@prismshadow/penguin-web/internal";

export function RateLine({
  geom,
  rates,
  breaks,
  paint,
  dash,
  opacity,
  className,
  hover = null,
  pointAtHover = false,
}: {
  /** The right-hand axis's geometry (makeRangeGeom over 0–100). */
  geom: ChartGeom;
  /** Per-bucket rate in percent, null where there is nothing to rate. */
  rates: readonly (number | null)[];
  /** Indices after which the axis skipped an interval: the line breaks there too. */
  breaks?: readonly number[];
  paint: ChartPaint;
  dash: string;
  opacity?: number;
  /** Extra classes for the strokes (a transition, pointer-events). */
  className?: string;
  /** The bucket singled out: a lone rate there grows. */
  hover?: number | null;
  /** Also mark the singled-out bucket with a point when it sits inside a stroke. */
  pointAtHover?: boolean;
}) {
  const runs = rateRuns(rates, breaks);
  const at = (i: number): readonly [number, number] => [geom.x(i), geom.y(rates[i]!)];
  const hovered = hover !== null && rates[hover] != null ? hover : null;
  const lone = runs.filter((run) => run.length === 1).map((run) => run[0]!);
  return (
    <>
      {runs.map((run) =>
        run.length === 1 ? (
          <ChartPoint
            key={run[0]}
            cx={at(run[0]!)[0]}
            cy={at(run[0]!)[1]}
            paint={paint}
            opacity={opacity}
            grow={hovered === run[0]}
          />
        ) : (
          <ChartLine
            key={run[0]}
            points={run.map(at)}
            paint={paint}
            dash={dash}
            className={className}
            opacity={opacity}
          />
        ),
      )}
      {pointAtHover && hovered !== null && !lone.includes(hovered) && (
        <ChartPoint cx={at(hovered)[0]} cy={at(hovered)[1]} paint={paint} opacity={opacity} />
      )}
    </>
  );
}
