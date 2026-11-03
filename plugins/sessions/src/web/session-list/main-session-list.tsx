import { S } from "../../lib/strings";

import type { MainSidebarState } from "./main-sidebar-controller";
import { renderMainListHeader } from "./main-list-header";
import { renderMainListDrafts } from "./main-list-drafts";
import { renderMainGroupByAgent } from "./main-group-by-agent";
import { renderMainGroupByWorkspace } from "./main-group-by-workspace";
import { renderMainGroupByTime } from "./main-group-by-time";
export function renderMainSessionList(scope: MainSidebarState) {
  const {
    navigate,
    agents,
    countsByAgent,
    loading,
    activeSessionId,
    sessions,
    byAgent,
    currentProjectId,
    groupMode,
    regrouped,
    collapsedGroups,
    pinnedGroups,
    sortMode,
    setDeletingWorkspace,
    searchOpen,
    setSearchOpen,
    searchInputRef,
    searchTitle,
    searchQuery,
    setSearchQuery,
    listSettingsOpen,
    setListSettingsOpen,
    canDrag,
    pendingLoads,
    setDeletingDraft,
    setGroupMode,
    workspaceGroupCounts,
    orderedAgents,
    orderedWorkspaceGroups,
    agentGroupSequence,
    workspaceGroupSequence,
    toggleGroup,
    togglePin,
    setSortMode,
    searching,
    groupsOnPage,
    groupPagerRow,
    filterRows,
    timeRows,
    timeGroups,
    timeMoreAgents,
    closeSearch,
    groupDragProps,
    shownDrafts,
    hasSearchMatches,
    trackedLoadMore,
    go,
    newChat,
    newEntity,
    newEntityLabel,
    addWorkspace,
    machineNameOf,
    registeredKeys,
    openRenameWorkspace,
    renderGroupBody,
    onNavigate,
  } = scope;
  return (
    <>
      {/* The list's header: its label and the controls (icon + tooltip family) — search, list
              settings (grouping + sort radios), and the mode-dependent create button (the created
              object follows the grouping mode). The search opens in place, over the label's
              column, so it costs no extra row; the magnifier becomes the field's leading glyph.
              No ruled separator at this boundary — the nav toggle above is the seam. The label
              names the grouping: workspaces, agents, or the recent ones by time. */}
      {renderMainListHeader(scope)}

      {/* Parked draft conversations (unsent new chats, newest first): pinned above both
          grouping modes — they belong to no Agent or Workspace until sent. Hidden
          entirely while there are none; the search filter applies to their titles too. */}
      {renderMainListDrafts(scope)}

      {/* The grouped list, one piece per grouping: a switch of the grouping remounts it, and
              the regrouped list surfaces as a whole under the theme's reveal. */}
      <div key={groupMode} {...(regrouped ? { "data-reveal": true } : {})}>
        {renderMainGroupByAgent(scope)}
        {groupMode === "agent" ? groupPagerRow() : null}
        {renderMainGroupByWorkspace(scope)}
        {groupMode === "workspace" ? groupPagerRow() : null}

        {/* Time mode: last day / last month / earlier, bucketed on each conversation's last
          activity — the same stamp the rows' compact timestamps and the recency sort read,
          so a row can never sit under a bucket its own timestamp contradicts. Empty buckets
          are dropped, and there are at most three, so this mode never paginates its groups.
          The buckets span every Agent and every Workspace: a bucket's "More" only reveals
          further rows already shown in it, while fetching the next page happens once for the
          whole Project, below. */}
        {renderMainGroupByTime(scope)}
      </div>

      {/* Quiet no-match line: the search is live and nothing — drafts included — hit. */}
      {searching && !hasSearchMatches && (
        <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
          {S.chat.searchNoMatches}
        </p>
      )}
    </>
  );
}
