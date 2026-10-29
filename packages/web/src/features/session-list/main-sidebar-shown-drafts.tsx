import { draftSessionTitle } from "../chat";
import type { useMainSidebarCloseSearch } from "./main-sidebar-close-search";

/** Consecutive live main statements 111..112, called once in original hook order. */
export function useMainSidebarShownDrafts(scope: ReturnType<typeof useMainSidebarCloseSearch>) {
  const {
    byAgent,
    groupMode,
    searchQuery,
    draftEntries,
    orderedAgents,
    orderedWorkspaceGroups,
    searching,
    filterRows,
    timeRows,
  } = scope;

  /** Parked drafts through the live search (matched on their first-line title). */
  const shownDrafts = searching
    ? draftEntries.filter((e) =>
        draftSessionTitle(e).toLowerCase().includes(searchQuery.trim().toLowerCase()),
      )
    : draftEntries;

  /** Whether the active search hits anything anywhere (drafts included) — drives the quiet no-match line. */
  const hasSearchMatches =
    shownDrafts.length > 0 ||
    (groupMode === "agent"
      ? orderedAgents.some((a) => filterRows(byAgent.get(a.agentId) ?? []).length > 0)
      : groupMode === "time"
        ? timeRows !== null && timeRows.length > 0
        : orderedWorkspaceGroups.some((g) => filterRows(g.sessions).length > 0));
  return { ...scope, shownDrafts, hasSearchMatches };
}
