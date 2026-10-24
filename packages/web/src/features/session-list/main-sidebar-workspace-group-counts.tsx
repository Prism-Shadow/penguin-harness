import { useMemo } from "react";
import {
  aggregateWorkspaceCounts,
  aggregateWorkspaceLatest,
  completeWorkspaceGroups,
  groupSessionsByWorkspace,
} from "../../lib/session-grouping";
import { machineForSession } from "../../lib/session-machines";
import { mergeRegisteredWorkspaces } from "./workspace-registry";
import { orderGroups } from "./group-order";
import { dropsEmployeeGroup } from "../agents";
import type { useMainSidebarSetGroupMode } from "./main-sidebar-set-group-mode";

/** Consecutive live main statements 75..82, called once in original hook order. */
export function useMainSidebarWorkspaceGroupCounts(
  scope: ReturnType<typeof useMainSidebarSetGroupMode>,
) {
  const {
    agents,
    countsByAgent,
    workspaceCountsByAgent,
    workspaceLatestActiveByAgent,
    sessions,
    byAgent,
    groupMode,
    pinnedGroups,
    groupOrder,
    registeredWorkspaces,
  } = scope;

  /** Workspace-mode per-group exact server totals (folded from the per-Agent per-Workspace counts). */
  const workspaceGroupCounts = useMemo(
    () => aggregateWorkspaceCounts(workspaceCountsByAgent),
    [workspaceCountsByAgent],
  );

  /**
   * Workspace-mode per-group newest-active-Session stamps (folded the same way): a group's
   * recency before any of its rows are loaded. Active only, like the rows a group shows: an
   * archived Session — a scheduled task's run, say — does not move the group it is not in.
   */
  const workspaceGroupLatest = useMemo(
    () => aggregateWorkspaceLatest(workspaceLatestActiveByAgent),
    [workspaceLatestActiveByAgent],
  );

  /**
   * Workspace groups (workspace mode): the loaded rows' groups, completed with every
   * Workspace the server's counts know (empty until their rows page in — the initial load
   * is each Agent's ten newest conversations, which touch only a few of dozens of
   * Workspaces), by recency with the temp group last, plus the manually-added Workspaces
   * as empty groups behind them (newest registration first).
   */
  const workspaceGroups = useMemo(
    () =>
      mergeRegisteredWorkspaces(
        completeWorkspaceGroups(
          // A Workspace is a directory on a machine: rows from two machines that share a path
          // string are two groups, and the "+" of each opens a chat on its own machine.
          groupSessionsByWorkspace(sessions, (s) => machineForSession(s.sessionId)),
          workspaceGroupCounts,
          workspaceGroupLatest,
        ),
        registeredWorkspaces,
      ),
    [sessions, workspaceGroupCounts, workspaceGroupLatest, registeredWorkspaces],
  );

  /**
   * The Agents that get a group: every Agent but an organization's employee with no
   * development conversation of its own in this list (agent-employment.ts). Its desk and
   * ticket sessions are company mode's and never counted here, so its group would only ever
   * be empty; it comes back the moment a development conversation with it exists. The
   * server's active total is raised by the loaded rows, which include a conversation created
   * since the counts were taken.
   */
  const groupAgents = useMemo(
    () =>
      agents.filter(
        (agent) =>
          !dropsEmployeeGroup(
            agent,
            Math.max(
              countsByAgent.get(agent.agentId)?.active ?? 0,
              byAgent.get(agent.agentId)?.length ?? 0,
            ),
          ),
      ),
    [agents, countsByAgent, byAgent],
  );

  // Pinned groups first within each mode, then the manual drag order within each pin
  // partition. Nothing dragged yet = an empty order = the automatic sort untouched (recency
  // for Workspace groups with the temp group last, the configured Agent order for Agents),
  // which is also what a group with no stored place falls back to.
  // The stored array belongs to the mode it was loaded for: handing an Agent list an
  // order of Workspace keys is a no-op only as long as the two key namespaces cannot
  // collide, and it costs the empty-order fast path on every render of the other mode.
  const orderedAgents = useMemo(
    () =>
      orderGroups(groupAgents, (a) => a.agentId, {
        pinned: pinnedGroups,
        order: groupMode === "agent" ? groupOrder : [],
      }),
    [groupAgents, pinnedGroups, groupOrder, groupMode],
  );
  const orderedWorkspaceGroups = useMemo(
    () =>
      orderGroups(workspaceGroups, (g) => g.key, {
        pinned: pinnedGroups,
        order: groupMode === "workspace" ? groupOrder : [],
      }),
    [workspaceGroups, pinnedGroups, groupOrder, groupMode],
  );

  // The FULL displayed group sequences a drop commits — every group of the mode, not the
  // page of groups on screen (see groupDragProps).
  const agentGroupSequence = useMemo(() => orderedAgents.map((a) => a.agentId), [orderedAgents]);
  const workspaceGroupSequence = useMemo(
    () => orderedWorkspaceGroups.map((g) => g.key),
    [orderedWorkspaceGroups],
  );
  return {
    ...scope,
    workspaceGroupCounts,
    workspaceGroupLatest,
    workspaceGroups,
    groupAgents,
    orderedAgents,
    orderedWorkspaceGroups,
    agentGroupSequence,
    workspaceGroupSequence,
  };
}
