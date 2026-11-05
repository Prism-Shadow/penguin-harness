/**
 * A machine job's steps as one row of segments, with a caption under them saying what the job is
 * doing: a step done, the step under way (it pulses, a live signal a theme may re-time), the step
 * a job failed at, and the steps still to come. It stands in a machine card's middle while a job
 * for the machine is queued or running; the segments are as many as the job's own steps, so the
 * row says how far along it is, and the caption says it in words.
 */
export type MachineStepState = "done" | "current" | "failed" | "pending";

export interface MachineStepperProps {
  /** One state per step of the job, in order. */
  steps: readonly MachineStepState[];
  /** What the job is doing ("Installing the program", "Queued"). */
  caption: string;
  /** The job is running: the caption takes the busy ink. */
  running: boolean;
  /** Layout only. */
  className?: string;
}

const FILL: Record<MachineStepState, string> = {
  done: "bg-tone-success-emphasis",
  current: "bg-tone-success-emphasis",
  failed: "bg-tone-danger-emphasis",
  pending: "bg-line",
};

export function MachineStepper({ steps, caption, running, className = "" }: MachineStepperProps) {
  return (
    <div className={className}>
      <div className="flex gap-px" aria-hidden="true">
        {steps.map((state, index) => (
          <span
            key={index}
            data-step-state={state}
            // The segment being worked on pulses as a live signal, so a theme can re-time it.
            data-live={state === "current" ? "dot" : undefined}
            className={`h-[3px] flex-1 rounded-sm ${FILL[state]} ${state === "current" ? "ui-live animate-pulse" : ""}`}
          />
        ))}
      </div>
      <div
        className={`mt-1 truncate text-xs ${running ? "text-tone-success-fg" : "text-fg-muted"}`}
      >
        {caption}
      </div>
    </div>
  );
}
