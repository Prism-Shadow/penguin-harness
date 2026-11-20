/**
 * The status strip at the head of a status page: where the subject stands on the leading end — a
 * summary pill, then a version element — and its primary actions held to the top of the other
 * end, so a version element that grows a line (a reason, a progress bar) never pushes them down.
 * On a phone-width pane the actions drop under the status instead of squeezing it. Layout only;
 * every part is the caller's.
 */
import type { ReactNode } from "react";

export function StatusStrip({
  status,
  summary,
  actions,
}: {
  /** The version element, or a line of state. */
  status?: ReactNode;
  /** A summary pill, before the status. */
  summary?: ReactNode;
  /** The primary actions, on the other end. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      {/* The pill keeps its own column, so the status's later lines start under its first. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-1.5 sm:flex-nowrap">
        {summary !== undefined && summary !== null && <div className="shrink-0">{summary}</div>}
        <div className="min-w-0 flex-1">{status}</div>
      </div>
      {actions !== undefined && actions !== null && (
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">{actions}</div>
      )}
    </div>
  );
}
