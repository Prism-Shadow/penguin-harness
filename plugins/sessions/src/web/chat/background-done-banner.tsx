/**
 * Completion notice of a background task (`[background_task_done]`, a harness-injected user
 * message reporting that a run_in_background command/subagent settled): an activity card of
 * the event kind (ActivityGroup), so collapsed it reads exactly like a settled "Done" work group
 * head (same chrome, title styling, sticky pinning against the scrollport, the same look in every
 * theme), showing only the outcome label; expanded, the report body (registry handle, what ran,
 * exit detail, output tail) renders in the tool cards' output styling. The Trace page shows the
 * raw marker text as-is.
 */
import { ActivityGroup, DISCLOSURE_OUTPUT_PRE_CLASS } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { BackgroundTaskDone } from "./agent-handoff";

export function BackgroundDoneBanner({ done, body }: { done: BackgroundTaskDone; body: string }) {
  const state =
    done.status === "completed" ? "done" : done.status === "stopped" ? "stopped" : "failed";
  return (
    <ActivityGroup
      kind="event"
      state={state}
      stateLabel={done.status}
      title={S.chat.backgroundDone(done.kind, done.status)}
    >
      <pre className={DISCLOSURE_OUTPUT_PRE_CLASS}>{body ? `${done.id}\n${body}` : done.id}</pre>
    </ActivityGroup>
  );
}
