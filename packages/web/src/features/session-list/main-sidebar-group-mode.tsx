import { useState } from "react";
import { useArrived } from "@prismshadow/penguin-ui";
import { loadPinnedSessions } from "./pinned-sessions";
import { loadWorkspaceRegistry, type WorkspaceEntry } from "./workspace-registry";

import {
  initialSessionSortMode,
  loadSessionOrder,
  type SessionSortMode,
} from "../../lib/session-order";

import { loadGroupOrder } from "./group-order";
import { initialGroupMode, type GroupMode } from "../../components/ui/group-list";

import { loadGroupSet } from "../../lib/main-sidebar-persistence";
import type { useMainSidebarNavCollapsed } from "./main-sidebar-nav-collapsed";

/** Consecutive live main statements 33..44, called once in original hook order. */
export function useMainSidebarGroupMode(scope: ReturnType<typeof useMainSidebarNavCollapsed>) {
  const { currentProjectId, collapseStoreKey, pinStoreKey } = scope;

  /** Grouping mode of the Session list (Workspace by default; the choice persists across sessions). */
  const [groupMode, setGroupModeState] = useState<GroupMode>(initialGroupMode);
  /** The reader has switched the grouping here: the regrouped list surfaces under the theme's reveal (never on load). */
  const regrouped = useArrived(groupMode);
  /** Collapsed groups (expanded by default), keyed by Agent id or Workspace group key depending on the mode; persisted per Project. */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<string>>(() =>
    loadGroupSet(collapseStoreKey),
  );
  /** Pinned groups (sorted before unpinned within their mode), keyed like collapsedGroups; persisted per Project. */
  const [pinnedGroups, setPinnedGroups] = useState<ReadonlySet<string>>(() =>
    loadGroupSet(pinStoreKey),
  );
  /** Pinned conversations (bubbled to the top of their group's active list), Session ids; persisted per Project frontend-side (lib/pinned-sessions.ts). */
  const [pinnedSessions, setPinnedSessions] = useState<ReadonlySet<string>>(() =>
    loadPinnedSessions(currentProjectId),
  );
  /** Row sort mode ("recent" default / "manual" drag order; the choice persists across sessions like the grouping mode). */
  const [sortMode, setSortModeState] = useState<SessionSortMode>(initialSessionSortMode);
  /** Manual row order (Session ids; only relative order within a co-rendered partition matters); persisted per Project AND grouping mode — the modes cut different partitions. */
  const [sessionOrder, setSessionOrder] = useState<readonly string[]>(() =>
    loadSessionOrder(currentProjectId, initialGroupMode()),
  );
  /**
   * Manual GROUP order (Workspace keys / Agent ids), persisted per Project and grouping
   * mode like the row order. Independent of `sortMode`: dragging a group is itself the
   * intent, so there is no second toggle — an empty array is the identity and the list
   * keeps its automatic sort. Empty in time mode, whose buckets are chronological
   * (group-order.ts).
   */
  const [groupOrder, setGroupOrder] = useState<readonly string[]>(() =>
    loadGroupOrder(currentProjectId, initialGroupMode()),
  );
  /** Manually-added Workspaces (header 新建工作区; render as empty groups until Sessions exist, with optional display aliases); persisted per Project. */
  const [registeredWorkspaces, setRegisteredWorkspaces] = useState<readonly WorkspaceEntry[]>(() =>
    loadWorkspaceRegistry(currentProjectId),
  );
  /** Registered Workspace being renamed (alias edit; null = none) and the alias being typed. The machine is half of which directory this is. */
  const [renamingWorkspace, setRenamingWorkspace] = useState<{
    path: string;
    machineId: string | null;
  } | null>(null);
  const [workspaceAliasText, setWorkspaceAliasText] = useState("");
  /** Registered Workspace pending removal confirmation (null = none); label = the group's displayed name for the confirm copy. */
  const [deletingWorkspace, setDeletingWorkspace] = useState<{
    path: string;
    machineId: string | null;
    label: string;
  } | null>(null);
  return {
    ...scope,
    groupMode,
    setGroupModeState,
    regrouped,
    collapsedGroups,
    setCollapsedGroups,
    pinnedGroups,
    setPinnedGroups,
    pinnedSessions,
    setPinnedSessions,
    sortMode,
    setSortModeState,
    sessionOrder,
    setSessionOrder,
    groupOrder,
    setGroupOrder,
    registeredWorkspaces,
    setRegisteredWorkspaces,
    renamingWorkspace,
    setRenamingWorkspace,
    workspaceAliasText,
    setWorkspaceAliasText,
    deletingWorkspace,
    setDeletingWorkspace,
  };
}
