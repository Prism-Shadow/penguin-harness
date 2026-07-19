/**
 * Trace file view (reworked):
 * grouped by **round (Task)** — a global summary at the top; below it, one
 * group per Task, with the card's top-right corner showing that round's stats
 * and a **context-usage donut ring** (upper bound = the session's context
 * window, default 128000; the three segments are cacheRead / cacheWrite /
 * output, showing both usage ratio and composition, with exact numbers on
 * hover), followed by that round's execution timeline and all of its messages.
 *
 * Token usage here is **broken down by category** rather than given as one
 * lump sum (a total alone doesn't show where the money went): this round's
 * input (with the portion that was a **cache hit** in parentheses, target
 * icon, hover shows the hit rate = cache hit ÷ input), this round's output,
 * plus tool-call count / cost / duration / output TPS. The conversation
 * page's stats row only gives input/output totals — cache composition and
 * this kind of debugging detail belongs here.
 *
 * Task attribution: model segments/tool spans carry their own taskIndex
 * (computed by the server), and messages fall into a Task's time range by
 * timestamp. Timeline ↔ message linked highlighting: hovering either side
 * highlights the other (only one bar / one message lights up at a time);
 * clicking a bar scrolls to the corresponding message and pins the highlight for PIN_MS.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type {
  ModelsResponse,
  TraceAnalysisResponse,
  TraceModelSegment,
  TraceTaskStats,
  TraceToolSpan,
} from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { ApiError } from "../../api/client";
import { S } from "../../lib/strings";
import {
  computeTps,
  formatMoney,
  formatPercent,
  formatTps,
  humanizeDuration,
  humanizeTokens,
} from "../../lib/format";
import { STAT_ICONS } from "../../lib/stat-icons";
import { resolveContextWindow } from "../../lib/context";
import { useTheme } from "../../state/theme";
import { Skeleton } from "../../components/ui/skeleton";
import { Chevron } from "../../components/ui/chevron";
import { GlyphIcon } from "../../components/ui/glyph-icon";
import { TokenDonut } from "../../components/ui/token-donut";
import { TimelineChart } from "./timeline-chart";
import type { TraceHighlight } from "./timeline-chart";
import { EventRow } from "./trace-event-row";

/**
 * The three Token buckets (token_usage.request). No `total` field: usage is
 * always shown broken down, and the total = input (cacheRead + cacheWrite) +
 * output — there's no second convention.
 */
interface Buckets {
  cacheRead: number;
  cacheWrite: number;
  output: number;
}
const zeroBuckets = (): Buckets => ({ cacheRead: 0, cacheWrite: 0, output: 0 });

interface TaskData {
  taskIndex: number;
  segments: TraceModelSegment[];
  spans: TraceToolSpan[];
  messages: OmniMessage[];
  toolCalls: number;
  durationMs: number;
}

const msOf = (ts: string): number => {
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
};

/** How long the target message row stays pinned highlighted after a bar-click jump (milliseconds). */
const PIN_MS = 2500;

/** Unique key for a message row (also the DOM scroll anchor). */
const rowKeyOf = (taskIndex: number, i: number): string => `${taskIndex}-${i}`;

/**
 * One row of the global summary: name on the left, value on the right
 * (tabular-nums right-aligned → values line up column-wise across rows, easy to compare at a glance).
 * Each item takes its own row, with three groups arranged side by side as
 * columns — laid out horizontally it would read as a blur of digits, while
 * giving each group a full row would waste the right half of the space.
 */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-[11px] text-gray-400">{label}</span>
      <span className="truncate font-mono text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** This round's input = cache hit (cacheRead) + cache miss (cacheWrite). */
const inputOf = (b: Buckets): number => b.cacheRead + b.cacheWrite;

/** Cache hit rate = cache hit ÷ this round's input; undefined when input is 0 → null (shown as `—`). */
const hitRateOf = (b: Buckets): number | null => {
  const input = inputOf(b);
  return input > 0 ? b.cacheRead / input : null;
};

/** Shared style for stat rows (icon + value, tabular figures). */
const CHIP_CLASS =
  "flex shrink-0 items-center font-mono text-[11px] tabular-nums text-gray-500 dark:text-gray-400";

/** Icon + value; hover shows what this item is (plain text alone doesn't convey the meaning). */
function StatChip({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <span title={label} aria-label={label} className={`${CHIP_CLASS} gap-1`}>
      <GlyphIcon d={icon} className="text-gray-400" />
      {value}
    </span>
  );
}

/**
 * This round's input chip: `↑ 84k (◎ 60k)` — the parenthesized number is the
 * portion that was a **cache hit** (target icon), with the hit rate shown on
 * hovering the parenthesized part. The hit rate is hover-only: cramming a
 * third number into the row would blow out this row of chips, and "how much
 * was hit" already gives a rough sense on its own — hover for the exact ratio.
 */
function InputChip({ buckets }: { buckets: Buckets }) {
  const input = inputOf(buckets);
  const hitTitle =
    `${S.traces.cacheHit} ${humanizeTokens(buckets.cacheRead)}` +
    ` · ${S.traces.hitRate} ${formatPercent(hitRateOf(buckets))}`;
  return (
    <span
      aria-label={`${S.traces.taskInput} ${humanizeTokens(input)} · ${hitTitle}`}
      className={CHIP_CLASS}
    >
      <span title={S.traces.taskInput} className="flex items-center gap-1">
        <GlyphIcon d={STAT_ICONS.input} className="text-gray-400" />
        {humanizeTokens(input)}
      </span>
      <span title={hitTitle} className="ml-1 flex items-center gap-0.5 text-gray-400">
        <span>(</span>
        <GlyphIcon d={STAT_ICONS.cacheHit} />
        <span>{humanizeTokens(buckets.cacheRead)}</span>
        <span>)</span>
      </span>
    </span>
  );
}

export function TraceFileView({
  projectId,
  agentId,
  sessionId,
  index,
  highlight,
  onHighlight,
}: {
  projectId: string;
  agentId: string;
  sessionId: string;
  index: number;
  highlight: TraceHighlight | null;
  onHighlight: (h: TraceHighlight | null) => void;
}) {
  const { currency } = useTheme();
  const [analysis, setAnalysis] = useState<TraceAnalysisResponse | null>(null);
  const [events, setEvents] = useState<OmniMessage[]>([]);
  /** events' starting index within the file (pagination offset): used to align with analysis.tasks' index ranges. */
  const [eventsOffset, setEventsOffset] = useState(0);
  const [total, setTotal] = useState(0);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<ReadonlySet<number>>(new Set());
  /** Message row pinned highlighted after a bar-click jump; auto-clears when its timer fires (independent of hover highlighting, and can stack with it). */
  const [pinnedRow, setPinnedRow] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (pinTimer.current) clearTimeout(pinTimer.current);
    },
    [],
  );

  useEffect(() => {
    setAnalysis(null);
    setEvents([]);
    setError(null);
    setCollapsed(new Set());
    setPinnedRow(null);
    let cancelled = false;
    Promise.all([
      api.getAgentTraceAnalysis(projectId, agentId, sessionId, index),
      api.getAgentTraceEvents(projectId, agentId, sessionId, index, 0, 1000),
      api.getModels(projectId).catch(() => null),
    ])
      .then(([a, e, m]) => {
        if (cancelled) return;
        setAnalysis(a);
        setEvents(e.events);
        setEventsOffset(e.offset);
        setTotal(e.total);
        setModels(m);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : S.common.unknownError);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, agentId, sessionId, index]);

  // Pricing for the session's Model (main session only; sub-session Tokens
  // live in their own Trace and aren't part of this file):
  // session_meta carries a paired reference (provider + model_id), matched against model config by that pair.
  const pricing = useMemo(() => {
    const meta = events.find((m) => m.type === "session_meta");
    const ref = meta ? (meta.payload as { model_id?: string; provider?: string }) : undefined;
    if (!ref?.model_id) return undefined;
    return models?.models.find(
      (m) =>
        m.modelId === ref.model_id && (ref.provider === undefined || m.provider === ref.provider),
    )?.pricing;
  }, [events, models]);

  const costOf = (b: Buckets): number | null => {
    if (!pricing) return null;
    return (
      (b.cacheRead * pricing.cacheRead +
        b.cacheWrite * pricing.cacheWrite +
        b.output * pricing.output) /
      1e6
    );
  };

  // Session context window (the upper bound for each round's donut ring): read once from session_meta, falling back to 128000 if unconfigured.
  const contextMax = useMemo(() => {
    const meta = events.find((m) => m.type === "session_meta");
    return resolveContextWindow(
      meta
        ? (meta.payload as { model_context_window?: number | string }).model_context_window
        : undefined,
    );
  }, [events]);

  const { tasks, global, statsByTask, globalLlmMs } = useMemo(() => {
    const g = { buckets: zeroBuckets(), toolCalls: 0 };
    const empty = new Map<number, TraceTaskStats>();
    if (!analysis)
      return {
        tasks: [] as TaskData[],
        global: g,
        statsByTask: empty,
        globalLlmMs: 0,
      };

    // A round's duration range always comes from the server (analysis.tasks,
    // computed over the whole file; the start is that round's first
    // request_begin). For a degenerate round with no Request, startTs is an
    // empty string → no range is built, and the duration counts as 0.
    const boundsByTask = new Map<number, { min: number; max: number }>();
    for (const t of analysis.tasks) {
      const min = Date.parse(t.startTs);
      const max = Date.parse(t.endTs);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        boundsByTask.set(t.taskIndex, { min, max });
      }
    }

    const map = new Map<number, TaskData>();
    const ensure = (ti: number): TaskData => {
      let d = map.get(ti);
      if (!d) {
        const b = boundsByTask.get(ti);
        d = {
          taskIndex: ti,
          segments: [],
          spans: [],
          messages: [],
          toolCalls: 0,
          durationMs: b ? Math.max(0, b.max - b.min) : 0,
        };
        map.set(ti, d);
      }
      return d;
    };
    for (const t of analysis.tasks) ensure(t.taskIndex); // empty rounds still need to appear in the list
    for (const s of analysis.modelSegments) ensure(s.taskIndex).segments.push(s);
    for (const s of analysis.toolSpans) {
      const d = ensure(s.taskIndex);
      d.spans.push(s);
      d.toolCalls += 1;
    }
    // Message attribution: **by the server-given index range**, never guessed
    // from timestamps. The same millisecond can be crowded with "the previous
    // round's last reply, compaction_begin, the compaction prompt, the next
    // round's request_begin" — splitting by a time boundary can't tell them
    // apart, and this round's reply would get misattributed to the next
    // round (the server already knows this message-by-message from its
    // sequential scan, no need to re-guess it here).
    // events is only used to populate the message list (a list view that
    // truthfully indicates truncation at the bottom); no **numeric value**
    // is ever derived from it: events is paginated (limit=1000, not
    // continued), so using it for aggregation would undercount Token/cost for a long Trace.
    const taskOfIndex = (k: number): number | null => {
      for (const t of analysis.tasks) {
        if (k >= t.messageFrom && k <= t.messageTo) return t.taskIndex;
      }
      return null;
    };
    for (let i = 0; i < events.length; i++) {
      const msg = events[i]!;
      if (msg.origin && msg.origin.length > 0) continue; // sub-session messages don't enter this file's grouping
      const ti = taskOfIndex(eventsOffset + i); // events is fetched starting at offset; recover the global index within the file
      if (ti !== null) ensure(ti).messages.push(msg);
    }
    g.toolCalls = analysis.toolSpans.length;
    // Numeric values always come from analysis.tasks, computed by the server
    // over **the whole file**. Note the differing conventions:
    //   - context: a **snapshot** (usage at that round's last non-compaction Request), not an accumulated value;
    //   - tokens: this round's **throughput** (sum across Requests), used for
    //     Token / cost; `tokens.output` doubles as the TPS numerator;
    //   - llmMs: the TPS denominator (this round's LLM generation time, with human approval wait already deducted).
    // The global summary and the per-round cards below share **the same
    // scope** (including compaction rounds): every global figure is the sum
    // across rounds, and they must add up.
    const statsByTask = new Map(analysis.tasks.map((t) => [t.taskIndex, t]));
    for (const t of analysis.tasks) {
      g.buckets.cacheRead += t.tokens.cacheRead;
      g.buckets.cacheWrite += t.tokens.cacheWrite;
      g.buckets.output += t.tokens.output;
    }
    const gLlm = analysis.tasks.reduce((s, t) => s + t.llmMs, 0);
    const tasks = [...map.values()].sort((a, b) => a.taskIndex - b.taskIndex);
    return { tasks, global: g, statsByTask, globalLlmMs: gLlm };
  }, [analysis, events, eventsOffset]);

  if (error) return <p className="text-xs text-red-600 dark:text-red-400">{error}</p>;
  if (!analysis) return <Skeleton className="h-40" />;

  // Duration is likewise "the sum across rounds" computed by the server over
  // the whole file (including compaction rounds, same scope as the per-round
  // display below): events is paginated, so subtracting first from last
  // would truncate a long Trace's duration (a 90s span where the first 1000 events only cover the first 30s → showing 30s).
  const globalMs = analysis.elapsedMs;

  const toggle = (ti: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(ti)) next.delete(ti);
      else next.add(ti);
      return next;
    });

  /** The **first** message row at that instant; a bar-initiated highlight/jump uses this to hit only one row. */
  const firstRowKeyAt = (ts: string): string | null => {
    for (const t of tasks) {
      const i = t.messages.findIndex((m) => m.timestamp === ts);
      if (i >= 0) return rowKeyOf(t.taskIndex, i);
    }
    return null;
  };

  // Target row for hover highlighting: use the highlight's own rowKey (from a
  // message row) if it has one; otherwise, with only ts (from a bar), take the first row.
  const hoveredRow =
    highlight?.rowKey ?? (highlight?.ts !== undefined ? firstRowKeyAt(highlight.ts) : null);

  /** Click a bar: scroll to the corresponding message row and pin the highlight — the mouse moving away afterward shouldn't clear it, so this is stored separately from hover highlighting. */
  const jumpTo = (ts: string) => {
    const rk = firstRowKeyAt(ts);
    if (rk === null) return;
    setPinnedRow(rk);
    // The target row may have just re-rendered from the highlight; wait for this frame to commit before scrolling.
    requestAnimationFrame(() => {
      rootRef.current
        ?.querySelector(`[data-trace-row="${rk}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    });
    if (pinTimer.current) clearTimeout(pinTimer.current);
    pinTimer.current = setTimeout(() => setPinnedRow(null), PIN_MS);
  };

  return (
    <div ref={rootRef} className="space-y-4">
      {/* Global summary: split into three groups by nature (count / Token
          usage / duration·cost·TPS), separated by vertical rules — a dozen
          metrics laid out in one row would read as a blur of digits; grouping lets you spot the kind you want at a glance. */}
      <div className="rounded-md border border-gray-200 p-3 dark:border-gray-800">
        <p className="mb-2 text-xs font-semibold text-gray-500">{S.traces.globalSummary}</p>
        {/* Three groups side by side as columns, each item within a group
            taking its own row (name on the left, value on the right): laid
            out in one row it's a blur of digits, while giving each group a
            full row only uses a small strip on the left and wastes the rest.
            Splitting into columns fills the width and keeps it to three rows tall. */}
        <div className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-3">
          {/* Counts */}
          <div>
            {/* Rounds = number of cards below (a compaction round counts as
                a round too): the global summary and the per-round display
                below share **the same scope** — every figure is the sum
                across rounds and must add up; how many of them are
                compaction rounds is answered separately by "compaction count". */}
            <SummaryRow label={S.traces.tasksLabel} value={String(analysis.tasks.length)} />
            <SummaryRow label={S.traces.toolCalls} value={String(global.toolCalls)} />
            <SummaryRow label={S.traces.compactions} value={String(analysis.compactionCount)} />
          </div>
          {/* Token usage: broken down by category (input / of which cache hit + hit rate / output), never given as a lump sum. */}
          <div>
            <SummaryRow label={S.chat.statInput} value={humanizeTokens(inputOf(global.buckets))} />
            <SummaryRow
              label={S.traces.cacheHit}
              value={`${humanizeTokens(global.buckets.cacheRead)} · ${formatPercent(hitRateOf(global.buckets))}`}
            />
            <SummaryRow label={S.chat.statOutput} value={humanizeTokens(global.buckets.output)} />
          </div>
          {/* Duration · cost · TPS (cost above duration, same order as the conversation page's stats row). */}
          <div>
            <SummaryRow
              label={S.chat.statCost}
              value={formatMoney(costOf(global.buckets), currency)}
            />
            <SummaryRow
              label={S.chat.statElapsed}
              value={humanizeDuration(Math.max(0, globalMs))}
            />
            {/* Global TPS = the output of every round (including compaction
                rounds) ÷ the sum of LLM generation time, same scope as the
                Token and duration above — both numerator and denominator
                come from analysis.tasks under the server's whole-file convention, so they share the same source. */}
            <SummaryRow
              label={S.chat.statTps}
              value={formatTps(computeTps(global.buckets.output, globalLlmMs))}
            />
          </div>
        </div>
      </div>

      {/* Grouped by Task */}
      {tasks.map((t) => {
        const open = !collapsed.has(t.taskIndex);
        // This round's convention as computed by the server over the whole
        // file: ctx = context snapshot at the end of this round (last
        // non-compaction Request), tokens = this round's throughput (used
        // for Token and cost, output doubles as the TPS numerator), llmMs = the TPS denominator.
        const st = statsByTask.get(t.taskIndex);
        const ctx = st?.context;
        const tokens = st?.tokens ?? zeroBuckets();
        return (
          <div
            key={t.taskIndex}
            className="overflow-hidden rounded-md border border-gray-200 dark:border-gray-800"
          >
            <button
              type="button"
              onClick={() => toggle(t.taskIndex)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800/60"
            >
              <Chevron open={open} size={13} className="text-gray-400" />
              <span className="shrink-0 text-sm font-semibold">
                {S.traces.task(t.taskIndex + 1)}
              </span>
              {/* Compaction rounds are explicitly flagged: their Token /
                  cost / duration / TPS count toward the global summary just
                  like user rounds do, and this badge answers "this round isn't answering the user, it's compacting context". */}
              {st?.compaction === true && (
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                  {S.traces.compactionRound}
                </span>
              )}
              <span className="min-w-0 flex-1" />
              {/* This round's stats: iconified in the top-right corner (hover gives a text explanation) */}
              <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
                <StatChip
                  icon={STAT_ICONS.toolCalls}
                  value={String(t.toolCalls)}
                  label={S.traces.toolCalls}
                />
                {/* Token usage broken down by category: this round's input
                    (parenthesized portion is the cache hit) + this round's
                    output. Uses the server's this-round throughput tokens (whole file, including compaction), not computed from truncated events. */}
                <InputChip buckets={tokens} />
                <StatChip
                  icon={STAT_ICONS.output}
                  value={humanizeTokens(tokens.output)}
                  label={S.traces.taskOutput}
                />
                <StatChip
                  icon={STAT_ICONS.cost}
                  value={formatMoney(costOf(tokens), currency)}
                  label={`${S.chat.statCost}（${currency}）`}
                />
                <StatChip
                  icon={STAT_ICONS.elapsed}
                  value={humanizeDuration(t.durationMs)}
                  label={S.chat.statElapsed}
                />
                <StatChip
                  icon={STAT_ICONS.tps}
                  value={formatTps(computeTps(tokens.output, st?.llmMs ?? 0))}
                  label={S.chat.statTps}
                />
              </div>
              {/* Context-usage donut ring at the end of this round (upper
                  bound = the session context window) + the three-segment
                  composition, with exact numbers on hover (see TokenDonut's
                  title). The exact figures are given by the chips on the
                  left; the ring is only a peripheral hint of the usage
                  ratio, hence its small size. It's fed the snapshot ctx
                  rather than the accumulated t.buckets — the latter
                  recounts the history each round carries forward, so a few
                  rounds of tool calls alone could fill the ring. A pure compaction Task has no snapshot and draws no ring. */}
              {ctx && (
                <TokenDonut
                  cacheRead={ctx.cacheRead}
                  cacheWrite={ctx.cacheWrite}
                  output={ctx.output}
                  max={contextMax}
                  size={22}
                />
              )}
            </button>

            {open && (
              <div className="space-y-3 p-3">
                {/* This round's timeline */}
                {(t.segments.length > 0 || t.spans.length > 0) && (
                  <div className="rounded-md border border-gray-100 p-2 dark:border-gray-800/60">
                    <p className="mb-1.5 text-[11px] font-medium text-gray-500">
                      {S.traces.timeline}
                    </p>
                    <TimelineChart
                      segments={t.segments}
                      toolSpans={t.spans}
                      highlight={highlight}
                      onHighlight={onHighlight}
                      onJump={jumpTo}
                      hideTaskLabel
                    />
                  </div>
                )}

                {/* This round's messages */}
                <div>
                  <p className="mb-1.5 text-[11px] font-medium text-gray-500">
                    {S.traces.messages}（{t.messages.length}）
                  </p>
                  {t.messages.length === 0 ? (
                    <p className="text-xs text-gray-400">{S.common.none}</p>
                  ) : (
                    <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800/60 dark:border-gray-800">
                      {t.messages.map((msg, i) => {
                        const rk = rowKeyOf(t.taskIndex, i);
                        return (
                          <EventRow
                            key={i}
                            msg={msg}
                            rowKey={rk}
                            matched={rk === hoveredRow || rk === pinnedRow}
                            onHighlight={(h) => onHighlight(h)}
                          />
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {events.length < total && (
        <p className="text-xs text-gray-400">{S.traces.truncatedNote(events.length, total)}</p>
      )}
    </div>
  );
}
