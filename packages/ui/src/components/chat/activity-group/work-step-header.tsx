import type { ReactNode } from "react";
import { useArrived } from "../../../motion/use-arrived";
import { DURATION_TEXT_CLASS, DurationSlot } from "../../feedback/duration-slot/duration-slot";
import { StatusIcon } from "../../icons/status-icon/status-icon";
import {
  ActivityMarkSlot,
  ActivityProgress,
  ActivityToggle,
} from "../../layout/disclosure-row/disclosure-row";
import type { ActivityStepSummary } from "./activity-group";

interface WorkStepHeaderProps {
  summary: ActivityStepSummary;
  count?: ReactNode;
  elapsed: string;
  totalStartMs?: number;
  totalDurationMs?: number;
  totalRunning: boolean;
  compactStep: boolean;
  progress: boolean;
  settledHere: boolean;
  titleInk: string;
  open: boolean;
}

/** The spoken summary, count, clock and arrow are also the visual reading order. */
export function WorkStepHeader({
  summary,
  count,
  elapsed,
  totalStartMs,
  totalDurationMs,
  totalRunning,
  compactStep,
  progress,
  settledHere,
  titleInk,
  open,
}: WorkStepHeaderProps) {
  // Only the public caption changes identity. Unrelated stream updates and clock ticks keep
  // the same text node; the disclosure button and its focus stay in place.
  const caption = compactStep
    ? JSON.stringify([summary.label, summary.description, summary.path?.short])
    : undefined;
  const changed = useArrived(caption);
  return (
    <>
      <ActivityMarkSlot mark={<StatusIcon state={summary.state} label={summary.stateLabel} />} />
      <span
        key={caption}
        data-step-summary=""
        data-reveal={(compactStep && changed) || undefined}
        className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap sm:gap-2"
      >
        <span
          key={summary.state}
          data-reveal={settledHere || undefined}
          data-slot="label"
          className={`max-w-full shrink-0 truncate text-xs font-semibold ${titleInk}`}
          data-tooltip={summary.label}
        >
          {summary.label}
        </span>
        {summary.description && (
          <span
            data-slot="detail"
            className="min-w-0 truncate text-xs text-fg-muted"
            data-tooltip={summary.description}
          >
            {summary.description}
          </span>
        )}
        {summary.path && (
          <span
            data-slot="detail"
            className="min-w-0 truncate font-mono text-xs text-fg-subtle"
            data-tooltip={summary.path.full}
            data-tooltip-content="code"
            data-tooltip-extra={summary.path.full !== summary.path.short || undefined}
          >
            {summary.path.short}
          </span>
        )}
      </span>
      {(count || totalRunning || totalDurationMs !== undefined) && (
        <span
          data-step-metrics=""
          className="inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap font-normal sm:gap-2"
        >
          {count && (
            <span data-slot="detail" data-step-count="" className={DURATION_TEXT_CLASS}>
              {count}
            </span>
          )}
          {(totalRunning || totalDurationMs !== undefined) && (
            <span
              data-step-elapsed=""
              data-tooltip={elapsed}
              className="inline-flex items-baseline"
            >
              <span className="sr-only">{elapsed}</span>
              <DurationSlot
                data-slot="detail"
                running={totalRunning}
                sinceMs={totalStartMs}
                durationMs={totalDurationMs}
              />
            </span>
          )}
        </span>
      )}
      <ActivityProgress running={progress} />
      <ActivityToggle open={open} />
    </>
  );
}
