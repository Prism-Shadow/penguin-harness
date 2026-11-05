/**
 * The chat page's session statistics: the elapsed reading the header chips and the details card
 * share, and the details card's list of totals.
 *
 * The list reads the way the Trace view's overview does: the same labels, number formats and
 * breakdown rows (components/ui/stat-hint.tsx), and a breakdown only ever behind a circled "?"
 * right of its total. Total Tokens keeps its cache hit rate inline in parentheses — a rate is a
 * reading of its own, not a part of the total — and puts its three usage parts behind the "?";
 * Cost puts its priced parts there, Elapsed its model API and tool components.
 */
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { CostParts } from "@prismshadow/penguin-server/api";
import {
  CostPartsRows,
  ElapsedSplitRows,
  StatHint,
  TokenPartsRows,
} from "../../components/ui/stat-hint";
import type { UsageParts } from "../../components/ui/stat-hint";
import {
  cacheHitRate,
  formatPercent,
  humanizeDuration,
  humanizeDurationLive,
} from "../../lib/format";
import { liveSessionElapsedMs, sessionElapsedBreakdown } from "../../lib/amsp/task-stats";
import type { TaskStatsTracker } from "../../lib/amsp/task-stats";
import { S } from "../../lib/strings";
import type { Currency } from "../../state/theme";

interface ElapsedSource {
  stats: TaskStatsTracker;
  taskOpen: boolean;
  taskStartLocalMs: number;
}

/**
 * The Session's elapsed time in ms: while a Task runs it ticks once per second over the live
 * cumulative (settled cross-Task total + the running Task's wall clock so far, see
 * liveSessionElapsedMs); when idle no timer runs and it is exactly the settled total.
 */
function useSessionElapsedMs({ stats, taskOpen, taskStartLocalMs }: ElapsedSource): number {
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
  return taskOpen
    ? liveSessionElapsedMs(stats, taskOpen, taskStartLocalMs, now)
    : stats.sessionElapsedMs;
}

/**
 * Elapsed value for the header statistics. Whole seconds while ticking, decimals only on the
 * settled value — same convention as LiveDuration on running tool/thinking cards.
 */
export function SessionElapsed(source: ElapsedSource) {
  const ms = useSessionElapsedMs(source);
  return <>{source.taskOpen ? humanizeDurationLive(ms) : humanizeDuration(ms)}</>;
}

/**
 * The elapsed total's model API time and tool wall time, each with its share of the total as it
 * ticks. Unlike the total they do not tick: each advances as a Request or tool closes, so mid-turn
 * they trail it (see sessionElapsedBreakdown).
 */
function SessionElapsedSplit(source: ElapsedSource) {
  const totalMs = useSessionElapsedMs(source);
  const { apiMs, toolMs } = sessionElapsedBreakdown(source.stats);
  return <ElapsedSplitRows apiMs={apiMs} toolMs={toolMs} totalMs={totalMs} />;
}

/**
 * What the elapsed total's "?" opens, or null while neither component has any time: a
 * conversation that has not run shows the bare time rather than a breakdown of zeroes. A
 * component that is genuinely zero beside a non-zero one still shows — "no tool time" is worth
 * reading.
 */
export function sessionElapsedSplit(source: ElapsedSource): ReactNode | null {
  const { apiMs, toolMs } = sessionElapsedBreakdown(source.stats);
  if (apiMs <= 0 && toolMs <= 0) return null;
  return <SessionElapsedSplit {...source} />;
}

/** The details card's statistics, one total per bullet. */
export function SessionStatsList({
  tokens,
  usage,
  cost,
  currency,
  elapsed,
  elapsedSplit,
}: {
  /** The live token total (main conversation and its subagents), formatted. */
  tokens: string;
  /**
   * The recorded usage from the last usage fetch, null until one has applied. The hit rate and
   * the token parts come from it, so mid-run they can trail the live total beside them until the
   * idle refresh reconciles the two.
   */
  usage: UsageParts | null;
  /** The cost reading, or null when the session has none to show (no pricing, nothing run yet). */
  cost: { text: string; uncosted: boolean; parts: CostParts | null } | null;
  currency: Currency;
  /** The elapsed reading. */
  elapsed: ReactNode;
  /** What the elapsed total's "?" opens, or null for no "?" (sessionElapsedSplit). */
  elapsedSplit: ReactNode | null;
}) {
  const hitRate = usage !== null ? cacheHitRate(usage.cacheRead, usage.cacheWrite) : null;
  const tokenParts =
    usage !== null && usage.cacheRead + usage.cacheWrite + usage.output > 0 ? usage : null;
  // Each bullet stays inline content (no flex), which is what keeps its marker.
  return (
    <ul className="list-inside list-disc space-y-1 font-mono text-xs">
      <li>
        {S.chat.statTotalTokens} {tokens}
        {hitRate !== null &&
          `${S.chat.statParenOpen}${S.chat.statCacheHit(formatPercent(hitRate))}${S.chat.statParenClose}`}
        {tokenParts !== null && (
          <StatHint label={S.chat.statTotalTokens} className="ml-1 align-middle">
            <TokenPartsRows parts={tokenParts} />
          </StatHint>
        )}
      </li>
      {cost !== null && (
        <li>
          {S.common.cost} {cost.text}
          {cost.uncosted ? " *" : ""}
          {cost.parts !== null && (
            <StatHint label={S.common.cost} className="ml-1 align-middle">
              <CostPartsRows parts={cost.parts} currency={currency} uncosted={cost.uncosted} />
            </StatHint>
          )}
        </li>
      )}
      <li>
        {S.chat.statElapsed} {elapsed}
        {elapsedSplit !== null && (
          <StatHint label={S.chat.statElapsed} className="ml-1 align-middle">
            {elapsedSplit}
          </StatHint>
        )}
      </li>
    </ul>
  );
}
