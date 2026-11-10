import { SIDEBAR_PAGE_SIZE, revealStep } from "../../lib/session-grouping";
import { MoreRow } from "@prismshadow/penguin-ui";
import { S } from "../../lib/strings";
import type { useMainSidebarRenderRows } from "./main-sidebar-render-rows";
export function useMainSidebarShowMore(scope: ReturnType<typeof useMainSidebarRenderRows>) {
  const { groupCaps, setGroupCaps, trackedLoadMore, pendingLoads } = scope;
  const showMore = (
    listKey: string,
    agents: string[],
    { shown, loaded, canFetch }: { shown: number; loaded: number; canFetch: boolean },
  ) => {
    const cap = groupCaps.get(listKey) ?? SIDEBAR_PAGE_SIZE;
    const step = revealStep({ cap, shown, loaded, canFetch });
    setGroupCaps((prev) => new Map(prev).set(listKey, step.cap));
    if (step.fetch) trackedLoadMore(listKey, agents);
  };
  const collapseRows = (listKey: string) => {
    setGroupCaps((prev) => {
      if (!prev.has(listKey)) return prev;
      const next = new Map(prev);
      next.delete(listKey);
      return next;
    });
  };
  const renderRevealRows = (
    listKey: string,
    plan: { hidden: number; canCollapse: boolean },
    onMore: () => void,
  ) => (
    <>
      {plan.hidden > 0 && (
        <MoreRow
          label={S.chat.expandRestSessions(plan.hidden)}
          ariaLabel={S.chat.expandRestSessions(plan.hidden)}
          pending={pendingLoads.has(listKey)}
          onClick={onMore}
          className="mt-0.5"
        />
      )}
      {plan.canCollapse && (
        <MoreRow
          label={S.chat.showLess}
          ariaLabel={S.chat.showLess}
          onClick={() => collapseRows(listKey)}
          {...(plan.hidden > 0 ? {} : { className: "mt-0.5" })}
        />
      )}
    </>
  );
  return { ...scope, showMore, collapseRows, renderRevealRows };
}
