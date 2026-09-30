/**
 * Session activity sparkline (Agents list card, GitHub-repo-Pulse-graph style): daily active
 * Session counts over the last N days, against zero, with a faint fill under the line — relative
 * ups and downs only, no scale or ticks; all-zero or empty data is a flat baseline at the bottom.
 * The package's Sparkline draws it; this binds what the card asks of it: the success ink (an
 * agent that is being used is a healthy one), the fill, and the card's 100×30 box.
 */
import { Sparkline } from "@prismshadow/penguin-ui";

export function ActivitySparkline({
  data,
  label,
  className = "",
}: {
  data: number[];
  label: string;
  className?: string;
}) {
  return (
    <Sparkline
      values={data}
      label={label}
      area
      tone="success"
      width={100}
      height={30}
      className={className}
    />
  );
}
