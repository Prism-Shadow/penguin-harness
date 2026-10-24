import { useEffect, useMemo, useRef } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { useSessionSeen } from "../../lib/session-seen";
import { isSidebarRow } from "../../lib/session-grouping";
import { pendingScheduleSessions, useSchedulesAcross } from "../schedules";
import {
  collapsedGroupsKey,
  pinnedGroupsKey,
  NO_SCHEDULED_SESSIONS,
} from "../../lib/main-sidebar-persistence";
import type { useMainSidebarInputs } from "./main-sidebar-inputs";

/** Consecutive live main statements 12..22, called once in original hook order. */
export function useMainSidebarSessions(scope: ReturnType<typeof useMainSidebarInputs>) {
  const { currentProject, allSessions, allByAgent, activeSessionId, machineIds } = scope;

  /**
   * The rows this list renders: the user's OWN active conversations (isSidebarRow). The store
   * also holds rows the chat page handed it for the conversation it shows — an archived
   * Session's stub, a subagent opened from the Agent panel, an organization's desk or ticket
   * Session (`company` Sessions, marked by `orgId` too, and by the durable `client === "org"`
   * stamp that outlives the organization). The store's own fetches already leave all of those
   * out, totals and Workspace stamps included (`category=active`, `excludeOrg`), so the counts
   * below are the list's exact share; this filter is for a row that entered by another door,
   * applied once, at the source, or the dropped row would still conjure the Workspace group,
   * Agent group or time bucket it belongs to. It applies whatever the company-mode switches say:
   * this list is the user's conversations, and a switch about the shell does not turn a
   * scheduler's Session into one.
   */
  const sessions = useMemo(() => allSessions.filter(isSidebarRow), [allSessions]);
  const byAgent = useMemo(() => {
    const map = new Map<string, SessionInfo[]>();
    for (const [agentId, rows] of allByAgent) map.set(agentId, rows.filter(isSidebarRow));
    return map;
  }, [allByAgent]);

  const currentProjectId = currentProject?.projectId ?? null;
  /** This Project's read markers; re-renders the rows whenever one is stamped. */
  const sessionSeen = useSessionSeen(currentProjectId);
  // The Project's scheduled tasks, shared with the dock's schedules panel through one store, so
  // that neither surface can take the other's answer away. The scope is the Project, not the
  // current Agent: this list draws every Agent's Sessions in every grouping mode, so whether a
  // row wears the mark must not depend on which Agent is current — the chat page moves that to
  // whatever conversation is open, and with a per-Agent list every other Agent's rows lost their
  // marks until the user came back to them. Re-read on every navigation: opening a conversation
  // is the moment a task may just have been created or switched off.
  const projectSchedules = useSchedulesAcross(currentProjectId, machineIds, activeSessionId ?? "");
  // The Sessions wearing the alarm clock: one bound task with a next fire time is enough. The
  // store re-renders these rows on every refresh (a navigation, a schedule event, a turn ending,
  // the panel's poll), and the server recomputes `nextFireAt` on each listing, so a task that
  // fired for the last time loses its mark at the next refresh.
  const pendingScheduled = useMemo(
    () => (projectSchedules === null ? null : pendingScheduleSessions(projectSchedules)),
    [projectSchedules],
  );
  // A null list means "this Project has not been read yet", never "this Project has no tasks":
  // reading it as the second blanks every alarm in the list for as long as a request takes. The
  // marks on screen stand until a real answer replaces them, which is the standing the pin and
  // the relay glyph get for free by being fields of the row itself.
  const lastScheduledRef = useRef<ReadonlySet<string>>(NO_SCHEDULED_SESSIONS);
  useEffect(() => {
    if (pendingScheduled !== null) lastScheduledRef.current = pendingScheduled;
  }, [pendingScheduled]);
  const scheduledSessions = pendingScheduled ?? lastScheduledRef.current;
  const collapseStoreKey = currentProjectId === null ? null : collapsedGroupsKey(currentProjectId);
  const pinStoreKey = currentProjectId === null ? null : pinnedGroupsKey(currentProjectId);
  return {
    ...scope,
    sessions,
    byAgent,
    currentProjectId,
    sessionSeen,
    projectSchedules,
    pendingScheduled,
    lastScheduledRef,
    scheduledSessions,
    collapseStoreKey,
    pinStoreKey,
  };
}
