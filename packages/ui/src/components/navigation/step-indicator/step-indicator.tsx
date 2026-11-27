/**
 * Where a short run of pages stands: the steps in order, each a number in a circle and its name,
 * the finished ones a check, the one on show in the body's ink and the rest muted, joined by a
 * line. It heads a dialog that pages through a decision a step at a time (an install: the server,
 * then who uses it, then ready), so the reader sees how many pages there are and which one this is.
 *
 * Only the steps the run will actually take are given: a step a reader never sees is not drawn
 * as skipped. One step is no run at all, so a caller leaves the indicator out below two.
 *
 * It is a list (`<ol>`), the page on show marked `aria-current="step"`; a finished step says so in
 * words to assistive technology (`doneText`), since its check is a shape alone. On a narrow
 * column the names of the steps not on show give way first, so the row never wraps.
 *
 * Props only: the names and the words are the caller's.
 */
import { CheckIcon } from "../../icons/marks/marks";

export interface StepIndicatorStep {
  key: string;
  label: string;
}

export function StepIndicator({
  steps,
  current,
  label,
  doneText,
  className = "",
}: {
  steps: readonly StepIndicatorStep[];
  /** The index of the step on show. Steps before it read as finished. */
  current: number;
  /** The list's accessible name ("Install steps"). */
  label: string;
  /** What a finished step's check says to assistive technology ("done"). */
  doneText: string;
  /** Layout only. */
  className?: string;
}) {
  return (
    <ol aria-label={label} className={`flex min-w-0 items-center gap-2 text-xs ${className}`}>
      {steps.map((step, index) => {
        const state = index < current ? "done" : index === current ? "current" : "pending";
        return (
          <li
            key={step.key}
            data-step={step.key}
            data-state={state}
            {...(state === "current" ? { "aria-current": "step" as const } : {})}
            className={`flex items-center gap-2 ${state === "current" ? "shrink-0" : "min-w-0"}`}
          >
            {index > 0 && <span aria-hidden className="h-px w-4 shrink-0 bg-line sm:w-6" />}
            <span
              aria-hidden
              className={`grid size-5 shrink-0 place-items-center rounded-full border tabular-nums ${
                state === "current"
                  ? "border-fg bg-fg text-canvas"
                  : state === "done"
                    ? "border-line-emphasis text-fg"
                    : "border-line text-fg-muted"
              }`}
            >
              {state === "done" ? <CheckIcon size={12} /> : index + 1}
            </span>
            <span
              className={`truncate ${
                state === "current" ? "font-semibold text-fg" : "text-fg-muted"
              }`}
            >
              {step.label}
              {state === "done" && <span className="sr-only"> {doneText}</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
