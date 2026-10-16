/**
 * The alarm clock on the session list's rows (`SessionListModule.rowActions`): a conversation a
 * scheduled task will still run wears it.
 */
import { useEffect, useMemo, useRef } from "react";
import { useMatch } from "react-router";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import type { RowAction } from "../../lib/session-row-contributions";
import { useProject } from "../../state/project";
import { pendingScheduleSessions } from "./schedule-panel-state";
import { useProjectSchedules } from "./schedule-store";

/** Standing "no Session is scheduled", so the first render has something to hold before any answer. */
const NO_SCHEDULED_SESSIONS: ReadonlySet<string> = new Set();

function useScheduledLabel(): (s: SessionInfo) => string | null {
  const { currentProject } = useProject();
  const activeSessionId = useMatch("/chat/:sessionId")?.params.sessionId ?? null;
  // The Project's scheduled tasks, shared with the dock's schedules panel through one store, so
  // that neither surface can take the other's answer away. The scope is the Project, not the
  // current Agent: the list draws every Agent's Sessions in every grouping mode, so whether a
  // row wears the mark must not depend on which Agent is current — the chat page moves that to
  // whatever conversation is open, and with a per-Agent list every other Agent's rows lost their
  // marks until the user came back to them. Re-read on every navigation: opening a conversation
  // is the moment a task may just have been created or switched off.
  const { items: projectSchedules } = useProjectSchedules(
    currentProject?.projectId ?? null,
    activeSessionId ?? "",
  );
  // The Sessions wearing the alarm clock: one bound task with a next fire time is enough. The
  // store re-renders these rows on every refresh (a navigation, a schedule event, a turn ending,
  // the panel's poll), and the server recomputes `nextFireAt` on each listing, so a task that
  // fired for the last time loses its mark at the next refresh.
  const pending = useMemo(
    () => (projectSchedules === null ? null : pendingScheduleSessions(projectSchedules)),
    [projectSchedules],
  );
  // A null list means "this Project has not been read yet", never "this Project has no tasks":
  // reading it as the second blanks every alarm in the list for as long as a request takes. The
  // marks on screen stand until a real answer replaces them, which is the standing the pin and
  // the relay glyph get for free by being fields of the row itself.
  const lastRef = useRef<ReadonlySet<string>>(NO_SCHEDULED_SESSIONS);
  useEffect(() => {
    if (pending !== null) lastRef.current = pending;
  }, [pending]);
  const scheduled = pending ?? lastRef.current;
  return (s) => (scheduled.has(s.sessionId) ? S.chat.sessionScheduled : null);
}

export const scheduledRowMark: RowAction = {
  sessionMark: { kind: "scheduled", useLabel: useScheduledLabel },
};
