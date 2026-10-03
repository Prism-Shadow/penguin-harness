import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { MoreRow, SkeletonList } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import { SIDEBAR_PAGE_SIZE, cutAtWatermark, revealPlan } from "../../lib/session-grouping";
import { orderSessionRows } from "../../lib/session-order";
import type { useMainSidebarShowMore } from "./main-sidebar-show-more";

/** Consecutive live main statements 134..134, called once in original hook order. */
export function useMainSidebarRenderGroupBody(scope: ReturnType<typeof useMainSidebarShowMore>) {
  const {
    hasMoreFor,
    activityWatermarkFor,
    loading,
    activeSessionId,
    pinnedSessions,
    sessionOrder,
    pendingLoads,
    groupCaps,
    searching,
    effectiveSortMode,
    fetchScope,
    renderRows,
    showMore,
    collapseRows,
    renderRevealRows,
  } = scope;

  const orderRows = (rows: SessionInfo[]) =>
    orderSessionRows(rows, (s) => s.sessionId, {
      pinned: pinnedSessions,
      sortMode: effectiveSortMode,
      order: sessionOrder,
      recencyOf: (s) => s.lastActiveAt,
    });
  const renderGroupBody = (
    groupKey: string,
    rows: SessionInfo[],
    withAgentHint: boolean,
    total: number | undefined,
    activeAgents: string[],
  ) => {
    // Row order: the pinned cluster first, then — under manual sort — the stored order
    // within each pin partition (lib/session-order.ts). Both reorder only rows already
    // FETCHED: a pinned conversation that lives past the loaded pages does not surface
    // until the reveal row pulls its page in (the list has no server-side pin), so the
    // pinned cluster leads what is loaded, not the Agent's whole history.
    // While searching, the display cap is bypassed — every loaded match shows, and the
    // reveal row hides (it pages the unfiltered list and would read as "more matches",
    // which the server cannot promise).
    //
    // Before any of that, the rows are cut at the group's watermark: an Agent group on
    // several machines and a Workspace group spanning Agents both merge several streams,
    // and only the rows above the most recent cursor that still has more are a true prefix
    // of the group's activity order. The rest wait in memory, so a reveal only ever adds
    // rows below the ones on screen. A search sees every loaded row.
    const visibleActive = cutAtWatermark(
      rows,
      searching || activeAgents.length === 0
        ? null
        : activityWatermarkFor(activeAgents, fetchScope(groupKey)),
      activeSessionId,
    );
    const orderedActive = orderRows(visibleActive);
    /** Manual sort only (never on a search-filtered view): drag scope + the group's full ordered list, so a drop commits the whole partition. */
    const dragCtx =
      effectiveSortMode === "manual" && !searching
        ? { scope: groupKey, fullRows: orderedActive }
        : undefined;
    // The reveal row counts THIS group's own hidden conversations and nothing else — no other
    // group's numbers reach it. `fullyLoaded` says the group's whole active share is already in
    // memory (no Agent that could hold a row of it has more to serve), which is when the
    // loaded rows become the truth: server counts refresh only on reload, so a count drifting
    // above reality would otherwise leave a row that reveals nothing behind it.
    const canFetch = activeAgents.some((id) => hasMoreFor(id, fetchScope(groupKey)));
    // One page of rows at a time, what the reveal row still hides, and whether "Show less"
    // has anything to fold away: the single rule revealPlan states.
    const plan = revealPlan({
      cap: groupCaps.get(groupKey) ?? SIDEBAR_PAGE_SIZE,
      loaded: visibleActive.length,
      total: total ?? 0,
      fullyLoaded: activeAgents.length > 0 && !canFetch,
    });
    const shownActive = searching ? orderedActive : orderedActive.slice(0, plan.shown);
    const hiddenActive = searching ? 0 : plan.hidden;
    const empty = visibleActive.length === 0;
    const activePending = pendingLoads.has(groupKey);
    // Rows the server counts that no page has loaded yet — a Workspace group known from
    // the counts alone while its own first page is on its way (or, after a failed fetch,
    // waiting on the reveal row below to be asked for again). Not "no conversations".
    const awaitingRows = !searching && visibleActive.length === 0 && hiddenActive > 0;
    return (
      <>
        {empty ? (
          loading || (awaitingRows && activePending) ? (
            // The same window the chat pane's skeleton covers: the Agent groups render as
            // soon as the Agents arrive, but the session pages are still being fetched —
            // "no Sessions yet" is not the honest answer until they land.
            <SkeletonList rows={2} />
          ) : awaitingRows ? null : (
            <p className="px-2.5 py-1 text-xs text-gray-400 dark:text-gray-600">
              {S.chat.noSessions}
            </p>
          )
        ) : (
          // Drag-reorder is offered under manual sort, and never on a search-filtered view.
          renderRows(shownActive, withAgentHint, dragCtx)
        )}

        {!searching &&
          renderRevealRows(groupKey, plan, () =>
            showMore(groupKey, activeAgents, {
              shown: plan.shown,
              loaded: visibleActive.length,
              canFetch,
            }),
          )}
      </>
    );
  };
  return { ...scope, orderRows, renderGroupBody };
}
