import { loadSessionOrder } from "../../lib/session-order";
import { loadGroupOrder } from "./group-order";
import { storeGroupMode, type GroupMode } from "../../components/ui/group-list";

import type { useMainSidebarCanDrag } from "./main-sidebar-can-drag";

/** Consecutive live main statements 77..81, called once in original hook order. */
export function useMainSidebarSetGroupMode(scope: ReturnType<typeof useMainSidebarCanDrag>) {
  const {
    currentProjectId,
    setGroupModeState,
    setSessionOrder,
    setGroupOrder,
    setGroupCaps,
    setGroupPage,
  } = scope;

  const setGroupMode = (mode: GroupMode) => {
    storeGroupMode(mode);
    setGroupModeState(mode);
    // The modes have unrelated group lists: go back to the first page, drop the per-group
    // reveal state (a cap keyed by an Agent id means nothing to a Workspace group), and
    // swap in this mode's own manual order (the stored sequence is read within partitions,
    // whose boundaries are exactly what the mode decides — one shared array would scramble).
    setSessionOrder(loadSessionOrder(currentProjectId, mode));
    setGroupOrder(loadGroupOrder(currentProjectId, mode));
    setGroupPage(0);
    setGroupCaps(new Map());
  };
  return {
    ...scope,
    setGroupMode,
  };
}
