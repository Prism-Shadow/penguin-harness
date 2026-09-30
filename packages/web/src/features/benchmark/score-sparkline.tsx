/**
 * Score sparkline of a Benchmark row: the scoreboard's Scores in order as one line, the newest
 * point marked. Scaled to the observed range with a floor of five points, so a series that moved
 * from 60 to 90 fills the box and a flat one draws a level line through its middle instead of
 * collapsing onto an edge; there are no ticks — the number beside it is the value. A single score
 * is a lone point. The package's Sparkline draws it; this binds the row's choices.
 */
import { Sparkline } from "@prismshadow/penguin-ui";

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
  return (
    <Sparkline
      values={values}
      label={label}
      scale="range"
      minSpan={MIN_SPAN}
      marker
      width={72}
      height={22}
      className={className}
    />
  );
}
