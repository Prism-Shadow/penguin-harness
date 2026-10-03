/**
 * The header's three statistics — Tokens, cost, elapsed — as the toolbar's chip row and the
 * details card both render them.
 */
import { useEffect, useState, type ReactNode } from "react";

import { S } from "../../../lib/strings";
import { humanizeDuration, humanizeDurationLive, humanizeTokens } from "../../../lib/format";
import type { StreamModel } from "../../../lib/amsp/stream-model";
import {
  liveSessionElapsedMs,
  sessionElapsedBreakdown,
  type TaskStatsTracker,
} from "../../../lib/amsp/task-stats";

import type { CostStatDisplay } from "../header-stats";

/**
 * Elapsed value for the header statistics: while a Task runs it ticks once per second over the
 * live cumulative (settled cross-Task total + the running Task's wall clock so far, see
 * liveSessionElapsedMs); when idle no timer runs and it renders exactly the settled total.
 * Whole seconds while ticking, decimals only on the settled value — same convention as
 * LiveDuration on running tool/thinking cards.
 */
function SessionElapsed({
  stats,
  taskOpen,
  taskStartLocalMs,
}: {
  stats: TaskStatsTracker;
  taskOpen: boolean;
  taskStartLocalMs: number;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!taskOpen) return;
    // Load-bearing, not redundant: `now` still holds whatever the state last saw (mount time,
    // or the final tick of a previous Task), and the first interval callback is a full second
    // away. The first live render after a Task starts must not compute from that stale clock,
    // so re-anchor immediately on entering the running state.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [taskOpen]);
  if (!taskOpen) return <>{humanizeDuration(stats.sessionElapsedMs)}</>;
  return <>{humanizeDurationLive(liveSessionElapsedMs(stats, taskOpen, taskStartLocalMs, now))}</>;
}

/** The header's three statistics — the chip row and the info dropdown render these verbatim. */
export interface HeaderStats {
  tokensText: string;
  /** Formatted session cost; null = nothing to show yet for this session (see header-stats.ts). */
  costText: string | null;
  /** Server-reported "some usage had no pricing" flag riding the shown figure (the chip's `*`). */
  costUncosted: boolean;
  elapsedNode: ReactNode;
  /**
   * The elapsed time's API / tool breakdown, already parenthesised, or null when neither
   * component has anything to report yet (a conversation that has not run shows the bare
   * time rather than a row of zeroes).
   */
  elapsedSplit: string | null;
}

/**
 * Computes the header statistics, live while a Task runs:
 *   - Tokens: session cumulative (main + subagents), already advancing per completed request;
 *   - Cost: advanceCostStat's display value — the fetched session cost plus a client-settled
 *     live estimate that carries across Task boundaries, sticky once shown (semantics
 *     documented in header-stats.ts). The live estimate applies the main Model's pricing to
 *     all of the open Task's buckets (subagents may run on different models), so it can be
 *     slightly off mid-task; usage fetches reconcile it to the server-recorded value;
 *   - Elapsed: ticking cumulative while running, settled cumulative when idle (SessionElapsed).
 */
export function headerStats(model: StreamModel, cost: CostStatDisplay): HeaderStats {
  const stats = model.stats;
  return {
    tokensText: humanizeTokens(stats.sessionTotal + stats.subagentTotal),
    costText: cost.costText,
    costUncosted: cost.costUncosted,
    elapsedNode: (
      <SessionElapsed
        stats={stats}
        taskOpen={model.taskOpen}
        taskStartLocalMs={model.taskStartLocalMs}
      />
    ),
    elapsedSplit: elapsedSplitText(stats),
  };
}

/**
 * The parenthesised API / tool breakdown of the elapsed time, or null when both components are
 * still zero. A component that is genuinely zero beside a non-zero one still prints: "no tool
 * time" is worth reading. Unlike the total beside it this does not tick — it advances as each
 * Request and tool closes, so mid-turn it trails the running total, and the two components can
 * also overlap each other. Both are why it is rendered as two measurements, not as a split of
 * the total (see sessionElapsedBreakdown).
 */
function elapsedSplitText(stats: TaskStatsTracker): string | null {
  const { apiMs, toolMs } = sessionElapsedBreakdown(stats);
  if (apiMs <= 0 && toolMs <= 0) return null;
  return `${S.chat.statParenOpen}${S.chat.statElapsedSplit(
    humanizeDuration(apiMs),
    humanizeDuration(toolMs),
  )}${S.chat.statParenClose}`;
}
