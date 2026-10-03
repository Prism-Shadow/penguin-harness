import { useEffect } from "react";
import { SIDEBAR_PAGE_SIZE, cutAtWatermark, groupPageSlice } from "../../lib/session-grouping";
import type { useMainSidebarShownDrafts } from "./main-sidebar-shown-drafts";

/** Consecutive live main statements 109..111, called once in original hook order. */
export function useMainSidebarFetchScope(scope: ReturnType<typeof useMainSidebarShownDrafts>) {
  const {
    isLoadedFor,
    activityWatermarkFor,
    loadMoreFor,
    groupMode,
    pendingLoads,
    setPendingLoads,
    workspaceGroupCounts,
    orderedWorkspaceGroups,
    searching,
    shownGroupPage,
  } = scope;

  /**
   * The server stream a group's fetches walk: its own, under Workspace grouping, or the
   * Agent's whole one otherwise. Only Workspace groups need their own — an Agent group IS
   * the whole stream, and a time bucket is cut from rows that are already loaded, so it
   * fetches nothing of its own at all.
   *
   * This is what makes the groups independent. Sharing one per-Agent cursor meant a group's
   * "load more" consumed the page its siblings were about to read: their rows appeared,
   * their reveal counts moved, and the group that asked could grow by less than a page — or
   * by nothing at all.
   */
  const fetchScope = (groupKey: string): string | undefined =>
    groupMode === "workspace" ? groupKey : undefined;

  /** loadMoreFor with an in-flight marker for the triggering "More" row (disable + loading text). */
  const trackedLoadMore = (groupKey: string, agentIds: string[]) => {
    setPendingLoads((prev) => new Set(prev).add(groupKey));
    void loadMoreFor(agentIds, fetchScope(groupKey)).finally(() => {
      setPendingLoads((prev) => {
        const next = new Set(prev);
        next.delete(groupKey);
        return next;
      });
    });
  };

  /**
   * Workspace mode: give every rendered group its own first page. The initial load reads
   * the Agent's whole stream, which is one stream cut by Workspace — it fills the groups
   * unevenly, so a group can come up with two rows while the neighbour it shares an Agent
   * with got eight. Any group left short of a full first page (or of its own total, if that
   * is smaller) asks for one down its own stream, once: the scoped pair is loaded from then
   * on and this is inert.
   *
   * Only the groups on screen ask — the pager bounds that to one page of groups — and a
   * search is left alone, since it renders loaded matches only and fetching cannot find more.
   *
   * The ask is marked in flight like a "More" click (pendingLoads), for two reasons: a group
   * the counts know but no page has loaded rows of starts out empty, and its body must read
   * as loading rather than as having no conversations; and the marker is what keeps this
   * effect from asking twice — every landed page changes the group list and re-runs it, and
   * an in-flight pair is still unloaded, so a second request would start its cursor over and
   * the group would later skip a page.
   */
  useEffect(() => {
    if (groupMode !== "workspace" || searching) return;
    for (const group of groupPageSlice(orderedWorkspaceGroups, shownGroupPage)) {
      const counts = workspaceGroupCounts.get(group.key);
      const total = counts?.totals.active ?? 0;
      const agents = [
        ...new Set([...(counts?.agents.active ?? []), ...group.sessions.map((s) => s.agentId)]),
      ];
      // Counts not in yet (0): nothing is known to be missing, so nothing is asked for. What
      // the group SHOWS is what a first page has to fill: rows in memory below its watermark
      // (another Agent's stream reached further) are not on screen.
      const loaded = cutAtWatermark(group.sessions, activityWatermarkFor(agents, group.key)).length;
      if (loaded >= Math.min(SIDEBAR_PAGE_SIZE, total)) continue;
      const unloaded = agents.filter((id) => !isLoadedFor(id, group.key));
      if (unloaded.length === 0) continue;
      const key = group.key;
      if (pendingLoads.has(key)) continue;
      setPendingLoads((prev) => new Set(prev).add(key));
      void loadMoreFor(unloaded, group.key).finally(() => {
        setPendingLoads((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      });
    }
  }, [
    groupMode,
    searching,
    orderedWorkspaceGroups,
    shownGroupPage,
    workspaceGroupCounts,
    isLoadedFor,
    activityWatermarkFor,
    loadMoreFor,
    pendingLoads,
  ]);
  return { ...scope, fetchScope, trackedLoadMore };
}
