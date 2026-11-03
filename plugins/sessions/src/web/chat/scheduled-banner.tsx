/**
 * Origin hint for a scheduled-task-triggered message: the origin block ([scheduled_task]) is
 * not rendered verbatim on screen; it collapses into one harness note (TranscriptNote): the fixed
 * phrase "Scheduled task", the task's name, and a localized trigger timestamp (a static display
 * with no navigation — task management lives on the Agent settings page's "Scheduled Tasks"
 * tab). The task prompt body itself is rendered as usual by the caller.
 */
import { TranscriptNote } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { formatDateTime } from "../../lib/format";
import type { ScheduledOrigin } from "./agent-handoff";

export function ScheduledBanner({ origin }: { origin: ScheduledOrigin }) {
  return (
    <TranscriptNote
      className="anim-msg my-2"
      label={S.chat.scheduledLabel}
      subject={origin.name}
      meta={[origin.firedAt ? formatDateTime(origin.firedAt) : null]}
    />
  );
}
