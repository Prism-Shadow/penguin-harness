/**
 * Completion notice of a background task (`[background_task_done]`, a harness-injected user
 * message reporting that a run_in_background command/subagent settled): rendered in the
 * thinking-block family — a one-line collapsible row showing only the outcome label
 * (status icon + "Background command finished" / "Background task failed"), expanding to
 * the report body (what ran, the registry handle, exit detail, output tail) in monospace.
 * The Trace page shows the raw marker text as-is.
 */
import { useState } from "react";
import { S } from "../../lib/strings";
import type { BackgroundTaskDone } from "./agent-handoff";
import { Chevron } from "../../components/ui/chevron";
import { StatusIcon } from "../../components/ui/status-icon";

export function BackgroundDoneBanner({ done, body }: { done: BackgroundTaskDone; body: string }) {
  const [open, setOpen] = useState(false);
  const ok = done.status === "completed";
  return (
    <div className="anim-msg my-2 w-fit max-w-full min-w-56 rounded-md border border-gray-200 dark:border-gray-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left transition-colors duration-150 hover:bg-gray-50 dark:hover:bg-gray-800"
      >
        <StatusIcon state={ok ? "done" : "failed"} label={done.status} />
        <span className="shrink-0 text-xs text-gray-500 dark:text-gray-400">
          {S.chat.backgroundDone(done.kind, ok)}
        </span>
        <span className="min-w-0 flex-1" />
        <Chevron open={open} className="text-gray-400" />
      </button>
      {open && (
        <div className="anim-fade border-t border-gray-100 px-3 py-2 dark:border-gray-800">
          <p className="font-mono text-[11px] text-gray-400 dark:text-gray-500">{done.id}</p>
          {body && (
            <p className="wrap-anywhere mt-1 font-mono text-xs leading-relaxed whitespace-pre-wrap text-gray-500 dark:text-gray-400">
              {body}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
