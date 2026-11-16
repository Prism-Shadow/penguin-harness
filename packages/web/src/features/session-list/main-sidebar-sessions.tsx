import { useMemo } from "react";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { useSessionSeen } from "../../lib/session-seen";
import { isSidebarRow } from "../../lib/session-grouping";
import { collapsedGroupsKey, pinnedGroupsKey } from "../../lib/main-sidebar-persistence";
import type { useMainSidebarInputs } from "./main-sidebar-inputs";

/** Consecutive live main statements 19..29, called once in original hook order. */
export function useMainSidebarSessions(scope: ReturnType<typeof useMainSidebarInputs>) {
  const { currentProject, allSessions, allByAgent } = scope;

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
  // The alarm clock on a row (the schedules module's contributed mark, session-row-mark.ts)
  // reads the same store over the same servers: one reader here would only race it, and the
  // row itself is where the mark's hook runs, so the list carries no schedule read of its own.
  const collapseStoreKey = currentProjectId === null ? null : collapsedGroupsKey(currentProjectId);
  const pinStoreKey = currentProjectId === null ? null : pinnedGroupsKey(currentProjectId);
  return {
    ...scope,
    sessions,
    byAgent,
    currentProjectId,
    sessionSeen,
    collapseStoreKey,
    pinStoreKey,
  };
}
