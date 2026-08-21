/**
 * Completion notice of a background task (`[background_task_done]`, a harness-injected user
 * message reporting that a run_in_background command/subagent settled): a standalone card in
 * the work group's own form — collapsed it reads exactly like a settled "Done" group header
 * (same chrome, title styling, sticky pinning against the scrollport), showing only the
 * outcome label; expanded, the report body (registry handle, what ran, exit detail, output
 * tail) renders in the tool cards' output styling. The Trace page shows the raw marker text
 * as-is.
 */
import { S } from "../../lib/strings";
import type { BackgroundTaskDone } from "./agent-handoff";
import { StatusIcon } from "../../components/ui/status-icon";
import {
  DISCLOSURE_CARD_CLASS,
  DISCLOSURE_OUTPUT_PRE_CLASS,
  DisclosureRow,
} from "./disclosure-row";

export function BackgroundDoneBanner({ done, body }: { done: BackgroundTaskDone; body: string }) {
  const ok = done.status === "completed";
  return (
    <div className={DISCLOSURE_CARD_CLASS}>
      <DisclosureRow
        variant="header"
        sticky
        icon={<StatusIcon state={ok ? "done" : "failed"} label={done.status} />}
        label={S.chat.backgroundDone(done.kind, ok)}
      >
        <pre className={DISCLOSURE_OUTPUT_PRE_CLASS}>{body ? `${done.id}\n${body}` : done.id}</pre>
      </DisclosureRow>
    </div>
  );
}
