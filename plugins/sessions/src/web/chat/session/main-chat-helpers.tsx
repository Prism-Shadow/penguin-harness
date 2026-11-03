import { SessionElapsed, sessionElapsedSplit } from "../session-stats";
import { useEffect, useState, type ReactNode } from "react";

import { CopyButton } from "@prismshadow/penguin-ui";
import { S } from "../../../lib/strings";
import { humanizeDuration, humanizeDurationLive, humanizeTokens } from "../../../lib/format";
import type { StreamModel } from "../../../lib/omni/stream-model";
import {
  liveSessionElapsedMs,
  sessionElapsedBreakdown,
  type TaskStatsTracker,
} from "../../../lib/omni/task-stats";

import type { CostStatDisplay } from "../header-stats";

export const PROCESS_POLL_MS = 15_000;

export function SessionIdRow({ sessionId }: { sessionId: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400">
        {S.chat.sessionIdLabel}
      </p>
      <div className="flex items-start gap-1.5">
        <span className="min-w-0 flex-1 break-all font-mono text-xs leading-5">{sessionId}</span>
        <CopyButton text={sessionId} label={S.chat.copySessionId} size="sm" className="shrink-0" />
      </div>
    </div>
  );
}

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
   * time rather than a row of zeroes). Printed in the details card only: the chip is the
   * card's trigger and shows the total alone.
   */
  elapsedSplit: ReactNode | null;
}

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

export const STAT_PATHS_PER_REQUEST = 100;
