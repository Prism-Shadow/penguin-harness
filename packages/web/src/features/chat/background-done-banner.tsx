/**
 * Completion notice of a background task (`[background_task_done]`, a harness-injected user
 * message reporting that a run_in_background command/subagent settled): the origin block is not
 * rendered verbatim; it collapses into one line naming what settled and its handle, with the
 * report body (what ran + the tail of its output) below in monospace. The Trace page shows the
 * raw marker text as-is.
 */
import { S } from "../../lib/strings";
import type { BackgroundTaskDone } from "./agent-handoff";

export function BackgroundDoneBanner({ done, body }: { done: BackgroundTaskDone; body: string }) {
  return (
    <div className="anim-msg my-2 w-fit max-w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-900">
      <p className="flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400">
        <span>{S.chat.backgroundDone(done.kind, done.status === "completed")}</span>
        <span className="font-mono text-gray-400 dark:text-gray-500">{done.id}</span>
      </p>
      {body && (
        <p className="wrap-anywhere mt-1.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-gray-500 dark:text-gray-400">
          {body}
        </p>
      )}
    </div>
  );
}
