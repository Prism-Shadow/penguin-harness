import { sectionWindow, SIDEBAR_PAGE_SIZE, TIME_LIST_KEY } from "../../lib/session-grouping";
import { Fold, GroupHeader, MoreRow, SkeletonList } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { GROUP_MODE_ICONS } from "../../components/ui/group-list";
import type { MainSidebarState } from "./main-sidebar-controller";

export function renderMainGroupByTime(scope: MainSidebarState) {
  const {
    effectiveSortMode,
    loading,
    sessions,
    groupMode,
    collapsedGroups,
    pendingLoads,
    toggleGroup,
    searching,
    timeRows,
    timeGroups,
    timeMoreAgents,
    trackedLoadMore,
    renderGroupBody,
    orderRows,
    groupCaps,
    projectActiveAgents,
    countsByAgent,
    renderRows,
    renderRevealRows,
    showMore,
  } = scope;
  const renderTimeList = () => {
    const ordered = timeGroups.map((group) => orderRows(group.sessions));
    const timeWindow = sectionWindow({
      sections: timeGroups.map((group, i) => ({
        rows: ordered[i] ?? [],
        folded: collapsedGroups.has(group.key),
      })),
      cap: groupCaps.get(TIME_LIST_KEY) ?? SIDEBAR_PAGE_SIZE,
      total: projectActiveAgents.reduce((sum, id) => sum + (countsByAgent.get(id)?.active ?? 0), 0),
      fullyLoaded: projectActiveAgents.length > 0 && timeMoreAgents.length === 0,
    });
    const shown = searching ? ordered : timeWindow.rows;
    return (
      <>
        {timeGroups.map((group, i) => {
          const rows = shown[i];
          // Past the window's edge: not drawn, the reveal row below counts its rows.
          if (rows === null || rows === undefined) return null;
          const collapsed = !searching && collapsedGroups.has(group.key);
          /** Manual sort only: a drop commits the bucket's whole ordered partition, not the windowed slice. */
          const dragCtx =
            effectiveSortMode === "manual" && !searching
              ? { scope: group.key, fullRows: ordered[i] ?? [] }
              : undefined;
          return (
            <div key={group.key} className="pt-2.5">
              <GroupHeader
                open={!collapsed}
                onToggle={() => toggleGroup(group.key)}
                glyph={GROUP_MODE_ICONS.time}
                label={S.chat.timeGroups[group.bucket]}
                uppercase
                count={group.sessions.length}
              />
              <Fold open={!collapsed}>{() => renderRows(rows, true, dragCtx)}</Fold>
            </div>
          );
        })}

        {/* Nothing loaded: "no conversations" only when the counts agree; rows the server
            counts but no page holds yet wait on the reveal row below instead. */}
        {timeGroups.length === 0 &&
          !searching &&
          (timeWindow.hidden === 0 ? (
            <p className="px-2.5 pt-3 text-xs text-gray-400 dark:text-gray-600">
              {S.chat.noSessions}
            </p>
          ) : pendingLoads.has(TIME_LIST_KEY) ? (
            <SkeletonList rows={2} />
          ) : null)}

        {!searching &&
          renderRevealRows(TIME_LIST_KEY, timeWindow, () =>
            showMore(TIME_LIST_KEY, timeMoreAgents, {
              shown: timeWindow.shown,
              loaded: timeWindow.reachable,
              canFetch: timeMoreAgents.length > 0,
            }),
          )}
      </>
    );
  };
  return groupMode !== "time" || timeRows === null ? null : loading && sessions.length === 0 ? (
    <SkeletonList rows={5} />
  ) : (
    renderTimeList()
  );
}
