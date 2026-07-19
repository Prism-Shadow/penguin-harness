/**
 * Origin hint for a scheduled-task-triggered message: the origin block (<scheduled_task>) is
 * not rendered verbatim on screen; it collapses into one line reading "Triggered by scheduled
 * task '<name>'" plus a localized trigger timestamp (a static display with no navigation — task
 * management lives on the Agent settings page's "Scheduled Tasks" tab). The task prompt body
 * itself is rendered as usual by the caller.
 */
import { S } from "../../lib/strings";
import { formatDateTime } from "../../lib/format";
import type { ScheduledOrigin } from "./agent-mentions";

export function ScheduledBanner({ origin }: { origin: ScheduledOrigin }) {
  return (
    <p className="anim-msg my-2 flex w-fit items-center gap-2 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600 dark:border-gray-800 dark:bg-gray-900 dark:text-gray-400">
      {S.chat.scheduledFrom(origin.name)}
      {origin.firedAt && (
        <span className="text-gray-400 dark:text-gray-500">{formatDateTime(origin.firedAt)}</span>
      )}
    </p>
  );
}
