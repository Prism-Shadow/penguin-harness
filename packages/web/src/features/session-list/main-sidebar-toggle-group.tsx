import type { SessionInfo } from "@prismshadow/penguin-server/api";
import {
  clampGroupPage,
  cutAtWatermark,
  groupPageCount,
  groupPageSlice,
  groupSessionsByTime,
  matchesSessionQuery,
} from "../../lib/session-grouping";
import { savePinnedSessions, togglePinnedSession } from "./pinned-sessions";
import { storeSessionSortMode, type SessionSortMode } from "../../lib/session-order";

import { GroupPager } from "../../components/ui/group-list";
import { saveGroupSet } from "../../lib/main-sidebar-persistence";
import type { useMainSidebarWorkspaceGroupCounts } from "./main-sidebar-workspace-group-counts";

/** Consecutive live main statements 86..102, called once in original hook order. */
export function useMainSidebarToggleGroup(
  scope: ReturnType<typeof useMainSidebarWorkspaceGroupCounts>,
) {
  const {
    countsByAgent,
    hasMoreFor,
    activityWatermarkFor,
    activeSessionId,
    sessions,
    currentProjectId,
    collapseStoreKey,
    pinStoreKey,
    groupMode,
    collapsedGroups,
    setCollapsedGroups,
    pinnedGroups,
    setPinnedGroups,
    pinnedSessions,
    setPinnedSessions,
    sortMode,
    setSortModeState,
    searchQuery,
    canDrag,
    groupPage,
    setGroupPage,
    orderedAgents,
    orderedWorkspaceGroups,
  } = scope;

  /** Collapse/expand a group. */
  const toggleGroup = (key: string) => {
    // Inert while searching: groups render force-opened then, so a click would change
    // nothing on screen while silently rewriting the persisted collapse state — the user
    // would find groups flipped once the query clears.
    if (searching) return;
    // Computed outside the state updater (theme.tsx convention): the persistence write is a
    // side effect, and updaters must stay pure (double-invoked in StrictMode).
    const next = new Set(collapsedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setCollapsedGroups(next);
    saveGroupSet(collapseStoreKey, next);
  };

  /** Pin / unpin a group (same toggle-and-persist convention as toggleGroup). */
  const togglePin = (key: string) => {
    const next = new Set(pinnedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setPinnedGroups(next);
    saveGroupSet(pinStoreKey, next);
  };

  /** Pin / unpin one conversation (row menu; same toggle-and-persist convention). */
  const toggleSessionPin = (sessionId: string) => {
    const next = togglePinnedSession(pinnedSessions, sessionId);
    setPinnedSessions(next);
    savePinnedSessions(currentProjectId, next);
  };

  /** Switch the row sort mode (store-then-set convention). Leaving manual KEEPS the stored order — toggling back restores it. */
  const setSortMode = (mode: SessionSortMode) => {
    storeSessionSortMode(mode);
    setSortModeState(mode);
  };

  /** Search active = a non-blank query is live-filtering the list. */
  const searching = searchQuery.trim() !== "";

  /**
   * Group pagination (Workspace / Agent modes — time mode has at most three buckets and
   * pages nothing). A pure display window: the manual group order still commits over the
   * FULL sequence (see groupDragProps), and no group's data loading depends on which page
   * it sits on. Search bypasses paging entirely — a match on page 3 would read as no match
   * at all, which is the same reason a collapsed group is forced open while searching.
   */
  const pagedGroupTotal =
    groupMode === "agent"
      ? orderedAgents.length
      : groupMode === "workspace"
        ? orderedWorkspaceGroups.length
        : 0;
  const groupPageTotal = groupPageCount(pagedGroupTotal);
  /** The page actually on screen: the stored one, pinned inside the pages that still exist. */
  const shownGroupPage = clampGroupPage(groupPage, pagedGroupTotal);

  /** The groups to render: this page's slice, or every match while searching. */
  const groupsOnPage = <T,>(groups: T[]): T[] =>
    searching ? groups : groupPageSlice(groups, shownGroupPage);

  /** Pager below the group list — rendered only once the groups overflow a single page. */
  const groupPagerRow = () =>
    !searching && groupPageTotal > 1 ? (
      <GroupPager page={shownGroupPage} pageCount={groupPageTotal} onChange={setGroupPage} />
    ) : null;

  /** The sort actually applied: a stored "manual" needs a drag-capable pointer to mean anything (see canDrag). */
  const effectiveSortMode: SessionSortMode = sortMode === "manual" && canDrag ? "manual" : "recent";

  /** Title filter of one group's loaded rows (search only sees loaded pages — there is no server-side search). */
  const filterRows = (rows: SessionInfo[]) =>
    searching ? rows.filter((s) => matchesSessionQuery(s, searchQuery)) : rows;

  /**
   * Time mode's loaded rows, through the search. Deliberately NOT memoized — the bucket
   * boundary is `Date.now()`, and a memo would freeze it at its last dependency change; the
   * compact relative timestamps rendered beside these rows are recomputed every render for
   * exactly the same reason. Null outside time mode, so no other mode pays for the pass.
   */
  const timeRows = groupMode === "time" ? filterRows(sessions) : null;

  /** Agents holding active rows anywhere in this Project — time mode's fetch fan-out (the counts are kept in step locally, so they cover freshly added rows too). */
  const projectActiveAgents = [...countsByAgent]
    .filter(([, counts]) => counts.active > 0)
    .map(([agentId]) => agentId);

  /**
   * Time mode's rows, cut at the list's watermark BEFORE bucketing. Every Agent (on every
   * machine) pages its own stream, so only the rows above the most recent cursor that still
   * has more are a true prefix of the Project's activity order; the rows below it stay in
   * memory until "load more" lowers it. That is what makes the list grow only at its bottom —
   * a fetched page can no longer land rows in "Last day" above an "Earlier" the user is
   * reading. A search sees every loaded row (a hidden match would read as no match), and the
   * open conversation always shows.
   */
  const timeVisible =
    timeRows === null
      ? []
      : cutAtWatermark(
          timeRows,
          searching ? null : activityWatermarkFor(projectActiveAgents),
          activeSessionId,
        );
  const timeGroups = timeRows === null ? [] : groupSessionsByTime(timeVisible, Date.now());

  /** Agents with an unfetched page left; the whole-list "More" of time mode pages all of them at once. */
  const timeMoreAgents = projectActiveAgents.filter((id) => hasMoreFor(id));
  return {
    ...scope,
    toggleGroup,
    togglePin,
    toggleSessionPin,
    setSortMode,
    searching,
    pagedGroupTotal,
    groupPageTotal,
    shownGroupPage,
    groupsOnPage,
    groupPagerRow,
    effectiveSortMode,
    filterRows,
    timeRows,
    projectActiveAgents,
    timeVisible,
    timeGroups,
    timeMoreAgents,
  };
}
