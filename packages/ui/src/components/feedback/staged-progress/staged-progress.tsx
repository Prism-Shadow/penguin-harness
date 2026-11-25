/**
 * A staged progress bar: one bar for a job that runs in a few stages (an install: check,
 * download, start, choose). The bar is cut into one segment per stage, so the stage boundaries
 * show without a label on each; the words beside the bar say which stage it is in.
 *
 * Stages before `current` are full, stages after it are empty, and the current one depends on
 * `status`:
 *
 * - `running` with a `value` (0 to 1): filled that far, moving between readings on the theme's
 *   layout motion, which reduced motion stills;
 * - `running` with no `value` (a backend that reports the stage but no amount): the progress
 *   bar's indeterminate mark, a short fill at the segment's start that pulses as a live signal
 *   (`ui-live`, `data-live="bar"`), so it never reads as an amount;
 * - `waiting` (the stage is the person's to take, or nothing has started): empty and still;
 * - `stopped` (it failed here): the fill it had, in the attention tone, still.
 *
 * `current` equal to the number of stages is the finished bar: every segment full. The bar is
 * full only then, since the last stage's segment fills with that stage's own progress.
 *
 * It is one `progressbar` to assistive technology: `aria-valuenow` is the share of the whole bar
 * while that is an amount, and absent while the current stage reports none; `valueText` says the
 * stage in words.
 */
import type { HTMLAttributes } from "react";
import { PROGRESS_FILL, PROGRESS_HEIGHT, type ProgressBarSize } from "../progress-bar/progress-bar";

export interface ProgressStage {
  key: string;
  /** Its share of the bar's width beside the other stages; 1 when omitted. */
  weight?: number;
}

export type StagedProgressStatus = "running" | "waiting" | "stopped";

/** The fill of a stopped stage that had reported no amount: the indeterminate mark's width. */
const UNKNOWN_SHARE = 1 / 3;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * How much of the whole bar is filled, from 0 to 1: the finished stages and the current one's
 * `value` (nothing while it reports none), each by its weight.
 */
export function stagedShare(
  stages: readonly ProgressStage[],
  current: number,
  value?: number,
): number {
  const total = stages.reduce((sum, stage) => sum + (stage.weight ?? 1), 0);
  if (total <= 0) return 0;
  let done = 0;
  stages.forEach((stage, index) => {
    const weight = stage.weight ?? 1;
    if (index < current) done += weight;
    else if (index === current) done += weight * clamp01(value ?? 0);
  });
  return clamp01(done / total);
}

export function StagedProgress({
  stages,
  current,
  value,
  status = "running",
  size = "sm",
  label,
  valueText,
  className = "",
  ...rest
}: {
  stages: readonly ProgressStage[];
  /** The index of the stage under way; `stages.length` when all are finished. */
  current: number;
  /** How far the current stage is, from 0 to 1, when its amount is known. */
  value?: number;
  status?: StagedProgressStatus;
  size?: ProgressBarSize;
  /** The bar's accessible name. */
  label: string;
  /** The current stage in words, for assistive technology. */
  valueText?: string;
  /** Layout only (a width, a margin). */
  className?: string;
} & Omit<HTMLAttributes<HTMLDivElement>, "className" | "children" | "role">) {
  const finished = current >= stages.length;
  const live = !finished && status === "running" && value === undefined;
  return (
    <div
      {...rest}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      {...(live ? {} : { "aria-valuenow": Math.round(stagedShare(stages, current, value) * 100) })}
      {...(valueText !== undefined ? { "aria-valuetext": valueText } : {})}
      data-status={finished ? "finished" : status}
      className={`flex w-full gap-1 ${className}`}
    >
      {stages.map((stage, index) => {
        const state = index < current ? "done" : index > current ? "pending" : status;
        const amount = value === undefined ? undefined : clamp01(value);
        return (
          <div
            key={stage.key}
            data-stage={stage.key}
            data-state={state}
            className={`min-w-0 overflow-hidden rounded-full bg-line-muted ${PROGRESS_HEIGHT[size]}`}
            style={{ flex: `${stage.weight ?? 1} 1 0` }}
          >
            {state === "done" && <div className={`h-full w-full ${PROGRESS_FILL.accent}`} />}
            {state === "running" &&
              (amount === undefined ? (
                <div
                  data-live="bar"
                  className={`ui-live h-full w-1/3 animate-pulse rounded-full ${PROGRESS_FILL.accent}`}
                />
              ) : (
                <div
                  data-layout-motion=""
                  className={`h-full rounded-full ${PROGRESS_FILL.accent}`}
                  style={{ width: `${amount * 100}%` }}
                />
              ))}
            {state === "stopped" && (
              <div
                className={`h-full rounded-full ${PROGRESS_FILL.attention}`}
                style={{ width: `${(amount ?? UNKNOWN_SHARE) * 100}%` }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
