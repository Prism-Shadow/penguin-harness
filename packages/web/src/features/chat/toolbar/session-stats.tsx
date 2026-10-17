import { SessionElapsed, sessionElapsedSplit } from "../session-stats";
/**
 * The header's three statistics — Tokens, cost, elapsed — as the toolbar's chip row and the
 * details card both render them.
 */
import { useEffect, useState, type ReactNode } from "react";

import type { SessionInfo } from "@prismshadow/penguin-server/api";
import { S } from "../../../lib/strings";
import { humanizeDuration, humanizeDurationLive, humanizeTokens } from "../../../lib/format";
import type { StreamModel } from "../../../lib/omni/stream-model";
import {
  bucketCostUsd,
  liveSessionElapsedMs,
  sessionElapsedBreakdown,
  type BucketPricing,
  type TaskStatsTracker,
} from "../../../lib/omni/task-stats";

import { advanceCostStat, type CostStatDisplay, type CostStatHold } from "../header-stats";

import { modelTaskStartCount } from "../agent-topology";
import type { SessionStreamState } from "../use-session-stream";
import type { Currency } from "../../../state/theme";

/**
 * Elapsed value for the header statistics: while a Task runs it ticks once per second over the
 * live cumulative (settled cross-Task total + the running Task's wall clock so far, see
 * liveSessionElapsedMs); when idle no timer runs and it renders exactly the settled total.
 * Whole seconds while ticking, decimals only on the settled value — same convention as
 * LiveDuration on running tool/thinking cards.
 */

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
  elapsedSplit: ReactNode | null;
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
    elapsedSplit: sessionElapsedSplit({
      stats,
      taskOpen: model.taskOpen,
      taskStartLocalMs: model.taskStartLocalMs,
    }),
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

/** What the live statistics read off the conversation's controller. */
export interface LiveStatsSession {
  stream: Pick<SessionStreamState, "model" | "loading">;
  selected: SessionInfo | null;
  costHoldRef: { current: CostStatHold };
  /** The Session's own Model's pricing, undefined when it has none. */
  modelPricing: BucketPricing | undefined;
  currency: Currency;
}

/**
 * The header statistics for this render. Called once per page render, past the page's loading
 * guard — never from a component that mounts only with a Session: the cost hold must see the
 * render with no Session too, which is what re-keys it on a switch.
 */
export function liveHeaderStats({
  stream,
  selected,
  costHoldRef,
  modelPricing,
  currency,
}: LiveStatsSession): HeaderStats {
  // Header statistics (chip row + info dropdown), live while a Task runs; recomputed every
  // stream version bump, so the in-place-mutated model stats always read fresh. The cost chip
  // advances its per-session hold with this render's observation (idempotent per observation,
  // so a replayed render converges — see header-stats.ts).
  const liveTaskUsd = stream.model.taskOpen
    ? bucketCostUsd(
        {
          cacheRead: stream.model.stats.taskCacheRead,
          cacheWrite: stream.model.stats.taskCacheWrite,
          output: stream.model.stats.taskOutput,
        },
        modelPricing,
      )
    : null;
  return headerStats(
    stream.model,
    advanceCostStat(costHoldRef.current, {
      sessionId: selected?.sessionId ?? null,
      // The cost tracker's Task boundary is the MODEL's, not the panel's: a completion notice
      // opens a new Task (zeroing the per-Task usage buckets) even though the panel keeps it
      // inside the launching Task's scope, so it must be counted here or the finished half's
      // live cost is dropped instead of folded.
      taskCount: modelTaskStartCount(stream.model.items),
      taskOpen: stream.model.taskOpen,
      loading: stream.loading,
      liveUsd: liveTaskUsd,
      currency,
    }),
  );
}
