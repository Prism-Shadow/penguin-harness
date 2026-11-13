/**
 * A round's four readings, always in this order: tool calls, cache hit rate, cost, duration.
 * They are all a round head shows, on one line that never wraps; the navigator's rows repeat them
 * bare.
 *
 * The head's line truncates as a whole: when the card is too narrow the last readings give way to
 * an ellipsis (the duration first — the order is kept, the tail yields), and a pointer on the line
 * shows the four as one sentence. The sentence is an unmarked hint, so it opens only while the
 * line is actually cut off.
 */
import { StatChip } from "@prismshadow/penguin-ui";
import type { TraceTaskStats } from "@prismshadow/penguin-server/api";
import { S } from "../../lib/strings";
import { cacheHitRate, formatMoney, formatPercent, humanizeDuration } from "../../lib/format";
import { STAT_ICONS } from "../../lib/stat-icons";
import type { Currency } from "../../state/theme";

/** The three Token buckets a round's figures are drawn from (token_usage.request, summed). */
export interface Buckets {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}

/** A round's input = cache hit (cacheRead) + cache miss (cacheWrite). */
export const inputOf = (b: Buckets): number => b.cacheRead + b.cacheWrite;

/** Cache hit rate of the input: the shared formula (lib/format.ts); input 0 → null, shown as `—`. */
export const hitRateOf = (b: Buckets): number | null => cacheHitRate(b.cacheRead, b.cacheWrite);

/**
 * A round's duration: from its first request_begin to its last message, both from the server. A
 * round with no request has an empty start and reads 0.
 */
export function roundDurationMs(st: TraceTaskStats): number {
  const startMs = Date.parse(st.startTs);
  const endMs = Date.parse(st.endTs);
  return Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
}

/** The four readings of one round. */
export interface RoundFactValues {
  toolCalls: number;
  hitRate: number | null;
  /** USD; absent when the file's model has no price. */
  cost: number | undefined;
  durationMs: number;
}

export function roundFactsOf(st: TraceTaskStats, toolCalls: number): RoundFactValues {
  return {
    toolCalls,
    hitRate: hitRateOf(st.tokens),
    cost: st.cost,
    durationMs: roundDurationMs(st),
  };
}

/** The four readings as one sentence, each named: the hint of a line that shows them bare. */
export function roundFactsText(f: RoundFactValues, currency: Currency): string {
  return [
    `${S.traces.toolCalls} ${f.toolCalls}`,
    `${S.traces.hitRate} ${formatPercent(f.hitRate)}`,
    `${S.common.cost} ${formatMoney(f.cost ?? null, currency)}`,
    `${S.chat.statElapsed} ${humanizeDuration(f.durationMs)}`,
  ].join(" · ");
}

/**
 * The four readings bare (`3 · 88% · $0.0031 · 14.2s`): a navigator row's. Formatted as the head
 * formats them, so a row and the card it opens show the same figures.
 */
export function roundFactsShort(f: RoundFactValues, currency: Currency): string {
  return [
    String(f.toolCalls),
    formatPercent(f.hitRate),
    formatMoney(f.cost ?? null, currency),
    humanizeDuration(f.durationMs),
  ].join(" · ");
}

/**
 * The head's line of readings. Inline chips, since an ellipsis cuts only inline content; spaced
 * by a margin, since a gap does not apply inside an inline run. Right-aligned while it fits.
 * No compact forms at phone width: a sub-cent cost's compact form is longer, not shorter, and the
 * line already gives way at its tail.
 * `data-tooltip-owned` keeps the head's toggle from offering the bare digits of this line as its
 * own cut-off text: the line's hint is the sentence.
 */
export function RoundFacts({ facts, currency }: { facts: RoundFactValues; currency: Currency }) {
  return (
    <span
      data-slot="facts"
      data-tooltip={roundFactsText(facts, currency)}
      data-tooltip-owned
      className="min-w-0 flex-1 truncate text-right font-mono text-xs whitespace-nowrap text-gray-500 [&>*+*]:ml-3 dark:text-gray-400"
    >
      <StatChip
        inline
        glyph={STAT_ICONS.toolCalls}
        value={String(facts.toolCalls)}
        label={S.traces.toolCalls}
      />
      <StatChip
        inline
        glyph={STAT_ICONS.cacheHit}
        value={formatPercent(facts.hitRate)}
        label={S.traces.hitRate}
      />
      <StatChip
        inline
        glyph={STAT_ICONS.cost}
        value={formatMoney(facts.cost ?? null, currency)}
        label={`${S.common.cost}（${currency}）`}
      />
      <StatChip
        inline
        glyph={STAT_ICONS.elapsed}
        value={humanizeDuration(facts.durationMs)}
        label={S.chat.statElapsed}
      />
    </span>
  );
}
