/**
 * Trace file view (reworked):
 * grouped by **round (Task)** — a global summary at the top; below it, one
 * group per Task, with the card's top-right corner showing that round's stats
 * and a **context-usage donut ring** (upper bound = the session's context
 * window, default 128000; the three segments are cacheRead / cacheWrite /
 * output, showing both usage ratio and composition, with exact numbers on
 * hover), followed by that round's execution timeline and all of its messages.
 *
 * Loading is per round: opening a file reads only its analysis — every number on the panel and
 * every round's message index range — and the file's newest round is open, read and scrolled into view. The other
 * rounds show their chips collapsed; opening one reads that round's range alone
 * (trace-rounds.ts). Round cards are drawn from the newest end, TRACE_ROUNDS_PAGE at a time,
 * behind an "earlier rounds" control, so a file of thousands of rounds is still a short list.
 *
 * Token usage here is **broken down by category** rather than given as one
 * lump sum (a total alone doesn't show where the money went): this round's
 * input (with the portion that was a **cache hit** in parentheses, target
 * icon, hover shows the hit rate = cache hit ÷ input), this round's output,
 * plus tool-call count / cost / duration / output TPS. The conversation
 * page's stats row only gives input/output totals — cache composition and
 * this kind of debugging detail belongs here. Every figure, cost included, is
 * the server's: the analysis prices each round with the cost center's rule,
 * so the file's total is what the toolbar shows for the same requests.
 *
 * Task attribution: model segments/tool spans carry their own taskIndex
 * (computed by the server), and a round's messages are the events in its
 * server-given index range. Timeline ↔ message linked highlighting: hovering either side
 * highlights the other (only one bar / one message lights up at a time);
 * clicking a bar scrolls to the corresponding message and pins the highlight for PIN_MS.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type {
  TraceAnalysisResponse,
  TraceModelSegment,
  TraceOtherSpan,
  TraceTaskStats,
  TraceToolSpan,
} from "@prismshadow/penguin-server/api";
import {
  Badge,
  Card,
  CardHeader,
  Chevron,
  GlyphIcon,
  Skeleton,
  StatChip,
  TokenDonut,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import {
  cacheHitRate,
  computeTps,
  formatAverage,
  formatMoney,
  formatPercent,
  formatTps,
  humanizeDuration,
  humanizeTokens,
} from "../../lib/format";
import { STAT_ICONS } from "../../lib/stat-icons";
import { resolveContextWindow } from "../../lib/context";
import { toneInk } from "../../lib/tone";
import { useTheme } from "../../state/theme";
import type { Currency } from "../../state/theme";
import {
  TRACE_ROUNDS_PAGE,
  expandedAfterAnalysis,
  loadRoundEvents,
  revealAfterAnalysis,
  roundSpan,
  roundsToRead,
  visibleRounds,
} from "./trace-rounds";
import type { RoundRange, TraceEventsSignal } from "./trace-rounds";
import { TimelineChart } from "./timeline-chart";
import type { TraceHighlight } from "./timeline-chart";
import { EventRow } from "./trace-event-row";

/**
 * Badge text for a round card, or null when the round is not a compaction turn.
 *
 * Reuses the chat stream's mode-aware row title rather than a Trace-local string, so the two
 * surfaces cannot drift apart: a `discard` round reads 清空 / "Clear" here exactly as it does
 * in the conversation, because it drops the old context instead of compacting it.
 *
 * `compaction` stays the sole gate — a round analyzed before the server carried the mode has
 * no `compactionMode`, and falls back to the compaction title the badge always showed.
 */
export function compactionBadgeLabel(st: TraceTaskStats | undefined): string | null {
  if (st?.compaction !== true) return null;
  return S.chat.compactionTitle(st.compactionMode ?? "summarize");
}

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

/** A round's timeline as the analysis gives it: everything a card draws without reading events. */
interface TaskTimeline {
  segments: TraceModelSegment[];
  spans: TraceToolSpan[];
  otherSpans: TraceOtherSpan[];
}

/**
 * One round's events as the view holds them, tagged with the range they were read for — a
 * refresh compares that range with the fresh analysis to find the round that grew. `rows` are
 * the round's own messages: a subagent's messages (`origin` set) are not this file's rounds.
 */
export type RoundEntry =
  | (RoundRange & { status: "loaded"; rows: OmniMessage[] })
  | (RoundRange & { status: "failed"; error: string });

/** How long the target message row stays pinned highlighted after a bar-click jump (milliseconds). */
const PIN_MS = 2500;

/** Unique key for a message row (also the DOM scroll anchor). */
const rowKeyOf = (taskIndex: number, i: number): string => `${taskIndex}-${i}`;

const isMainSession = (msg: OmniMessage): boolean => !(msg.origin && msg.origin.length > 0);

/** Identity of the range a read was issued for, so a read the analysis has since moved past is dropped. */
const rangeKey = (r: RoundRange): string => `${r.messageFrom}:${r.messageTo}`;

/**
 * The **first** message row at that instant among the open rounds' read rows; a bar-initiated
 * highlight/jump uses this to hit only one row.
 */
function firstRowKeyAt(
  rounds: ReadonlyMap<number, RoundEntry>,
  expanded: ReadonlySet<number>,
  ts: string,
): string | null {
  const open = [...expanded].sort((a, b) => a - b);
  for (const ti of open) {
    const entry = rounds.get(ti);
    if (entry?.status !== "loaded") continue;
    const i = entry.rows.findIndex((m) => m.timestamp === ts);
    if (i >= 0) return rowKeyOf(ti, i);
  }
  return null;
}

/**
 * One row of the global summary: name on the left, value on the right
 * (tabular-nums right-aligned → values line up column-wise across rows, easy to compare at a glance).
 * Each item takes its own row, with three groups arranged side by side as
 * columns — laid out horizontally it would read as a blur of digits, while
 * giving each group a full row would waste the right half of the space.
 *
 * `detail` is the breakdown behind the value: the row shows the total alone and keeps the
 * breakdown in its hover text, the same way the per-round chips do. A reader with no hover
 * gets it from `sr-only` text rather than from an `aria-label`: this row is a bare `div`,
 * whose role is `generic`, and ARIA prohibits naming that role — a label here would be
 * dropped, while hidden text is read in place, right after the value it belongs to (the
 * same way an update hint is folded into a button elsewhere in the app). An empty detail
 * renders neither: a tooltip repeating only the visible label says nothing.
 */
function SummaryRow({ label, value, detail }: { label: string; value: string; detail?: string }) {
  const hasDetail = detail !== undefined && detail !== "";
  return (
    <div
      data-tooltip={hasDetail ? `${label}${detail}` : undefined}
      className="flex items-baseline justify-between gap-3 py-0.5"
    >
      <span className="shrink-0 text-xs text-gray-400">{label}</span>
      <span className="truncate font-mono text-sm font-semibold tabular-nums">{value}</span>
      {hasDetail && <span className="sr-only">{detail}</span>}
    </div>
  );
}

/** This round's input = cache hit (cacheRead) + cache miss (cacheWrite). */
const inputOf = (b: Buckets): number => b.cacheRead + b.cacheWrite;

/** Cache hit rate of this round's input: the shared formula (lib/format.ts cacheHitRate, also used by the Cost center's bubble); input 0 → null (shown as `—`). */
const hitRateOf = (b: Buckets): number | null => cacheHitRate(b.cacheRead, b.cacheWrite);

/**
 * The size, ink and face a round's readings share, and no chip breaking over two lines. The chips
 * themselves are the package's `StatChip` (a glyph and a value in tabular figures, named by its
 * tooltip), which take these from the row they sit in; the input chip below is two readings in
 * one and spells its own.
 */
const CHIP_ROW_CLASS = "whitespace-nowrap font-mono text-xs text-gray-500 dark:text-gray-400";

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
      className="flex shrink-0 items-center tabular-nums"
    >
      <span data-tooltip={S.traces.taskInput} className="flex items-center gap-1">
        <GlyphIcon d={STAT_ICONS.input} />
        {humanizeTokens(input)}
      </span>
      {/* The parentheses hug the reading they enclose; the glyph keeps a chip's gap to its figure. */}
      <span data-tooltip={hitTitle} className="ml-1 flex items-center text-gray-400">
        <span>(</span>
        <span className="flex items-center gap-1">
          <GlyphIcon d={STAT_ICONS.cacheHit} />
          {humanizeTokens(buckets.cacheRead)}
        </span>
        <span>)</span>
      </span>
    </span>
  );
}

/**
 * The parenthesised API / tool breakdown printed after a duration, or the empty string when
 * neither component has anything. The two are measurements of the same span, not a partition
 * of it: a tool running in the background overlaps the model's decoding, while approval waits
 * and harness overhead belong to neither — so they may exceed or fall short of the duration
 * they follow, and neither is ever derived from the other.
 */
function durationSplit(apiMs: number, toolMs: number): string {
  if (apiMs <= 0 && toolMs <= 0) return "";
  return `${S.chat.statParenOpen}${S.chat.statElapsedSplit(
    humanizeDuration(apiMs),
    humanizeDuration(toolMs),
  )}${S.chat.statParenClose}`;
}

/** A file's analysis and what it decided: the view's state per file, reset on a switch to another file. */
export interface FileState {
  analysis: TraceAnalysisResponse | null;
  /** Open rounds, by taskIndex. Held beside the analysis: a fresh analysis decides which new round opens. */
  expanded: ReadonlySet<number>;
  /**
   * The round the latest analysis asks to scroll into view: the newest one on the analysis that
   * opened the file, null on every refresh. The view scrolls when this becomes non-null.
   */
  reveal: number | null;
}

/** What the view shows before a file's analysis lands, and after a switch to another file. */
export const EMPTY_FILE: FileState = { analysis: null, expanded: new Set(), reveal: null };

/** The view's state once an analysis of its file lands, from the state it held before. */
export function fileAfterAnalysis(prev: FileState, analysis: TraceAnalysisResponse): FileState {
  const previous = prev.analysis?.tasks ?? null;
  return {
    analysis,
    expanded: expandedAfterAnalysis(previous, analysis.tasks, prev.expanded),
    reveal: revealAfterAnalysis(previous, analysis.tasks),
  };
}

/** `rounds` without its failed reads: a refresh retries them. The same map when there are none. */
function withoutFailures(rounds: ReadonlyMap<number, RoundEntry>): ReadonlyMap<number, RoundEntry> {
  if (![...rounds.values()].some((e) => e.status === "failed")) return rounds;
  return new Map([...rounds].filter(([, e]) => e.status !== "failed"));
}

export function TraceFileView({
  projectId,
  agentId,
  sessionId,
  index,
  reloadSignal,
  highlight,
  onHighlight,
}: {
  projectId: string;
  agentId: string;
  sessionId: string;
  index: number;
  /**
   * Bumped by the panel every time it re-lists (a re-show, or a turn settling while the panel
   * is showing). Any change means "re-read this file": a Trace is APPENDED TO while the
   * Session runs, so the same `index` at a larger size is the ordinary case and a load keyed
   * on `index` alone would never re-run for it.
   */
  reloadSignal: number;
  highlight: TraceHighlight | null;
  onHighlight: (h: TraceHighlight | null) => void;
}) {
  const { currency } = useTheme();
  const [file, setFile] = useState<FileState>(EMPTY_FILE);
  const [rounds, setRounds] = useState<ReadonlyMap<number, RoundEntry>>(new Map());
  const [shownRounds, setShownRounds] = useState(TRACE_ROUNDS_PAGE);
  const [error, setError] = useState<string | null>(null);
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

  // Switching to a DIFFERENT file clears the view — back to the skeleton, with the open
  // rounds, the read rounds, the revealed earlier rounds and the pinned row forgotten because
  // they name rounds this file does not have. Reset during render (React's documented "adjust
  // state when a prop changes" pattern), which is what keeps it out of the load effect below:
  // that effect also runs for a REFRESH of the file already on screen, and blanking there
  // would flash a skeleton, drop the highlight and close every round the reader opened.
  const fileKey = `${projectId}/${agentId}/${sessionId}/${index}`;
  const [renderedFileKey, setRenderedFileKey] = useState(fileKey);
  if (renderedFileKey !== fileKey) {
    setRenderedFileKey(fileKey);
    setFile(EMPTY_FILE);
    setRounds(new Map());
    setShownRounds(TRACE_ROUNDS_PAGE);
    setError(null);
    setPinnedRow(null);
  }

  // Round reads belong to the file they were issued for: switching files (or unmounting)
  // cancels them all, and the registry of reads in flight starts over with the new file.
  const fileSignal = useRef<TraceEventsSignal>({ cancelled: false });
  const inflight = useRef(new Map<number, string>());
  useEffect(() => {
    const signal = { cancelled: false };
    fileSignal.current = signal;
    inflight.current = new Map();
    return () => {
      signal.cancelled = true;
    };
  }, [fileKey]);

  // Load the analysis, and re-load it whenever the panel's signal moves. It overwrites what is
  // on screen in place — an in-flight refresh keeps the current content readable, and its
  // outcome is what clears or sets the error, since nothing was cleared up front. No event is
  // read here: the rounds to read follow from the analysis (the effect below).
  useEffect(() => {
    const signal = { cancelled: false };
    api
      .getAgentTraceAnalysis(projectId, agentId, sessionId, index)
      .then((a) => {
        if (signal.cancelled) return;
        setFile((prev) => fileAfterAnalysis(prev, a));
        setRounds(withoutFailures);
        setError(null);
      })
      .catch((err: unknown) => {
        if (!signal.cancelled) setError(apiErrorText(err));
      });
    return () => {
      signal.cancelled = true;
    };
  }, [projectId, agentId, sessionId, index, reloadSignal]);

  // Read the open rounds that need it: a round opened for the first time, and an open round
  // whose range the latest analysis moved (the running round, which grows every turn). A
  // re-read keeps the rows already on screen until it lands. A round being read for the same
  // range is not asked for twice, and a read the analysis has since moved past is dropped when
  // it lands — the newer read is the one that counts.
  const { analysis, expanded } = file;
  useEffect(() => {
    if (analysis === null) return;
    const signal = fileSignal.current;
    for (const round of roundsToRead(analysis.tasks, shownRounds, expanded, rounds)) {
      const range: RoundRange = {
        taskIndex: round.taskIndex,
        messageFrom: round.messageFrom,
        messageTo: round.messageTo,
      };
      const key = rangeKey(range);
      if (inflight.current.get(range.taskIndex) === key) continue;
      inflight.current.set(range.taskIndex, key);
      const land = (entry: RoundEntry) => {
        if (signal.cancelled || inflight.current.get(range.taskIndex) !== key) return;
        inflight.current.delete(range.taskIndex);
        setRounds((prev) => new Map(prev).set(range.taskIndex, entry));
      };
      loadRoundEvents(
        (offset, limit) =>
          api.getAgentTraceEvents(projectId, agentId, sessionId, index, offset, limit),
        range,
        { signal },
      )
        .then((events) => land({ ...range, status: "loaded", rows: events.filter(isMainSession) }))
        .catch((err: unknown) => land({ ...range, status: "failed", error: apiErrorText(err) }));
    }
  }, [analysis, expanded, shownRounds, rounds, projectId, agentId, sessionId, index]);

  // Opening a file brings its open newest round into view: it is the last card, under the
  // summary and the collapsed rounds drawn before it, so without this the panel opens on
  // everything but the round it just opened. The card's top goes to the top of the panel, so
  // its body — still being read — unfolds below it without moving it. Instant, not smooth: a
  // smooth scroll would sweep past every card above it. Only the analysis that opened the file
  // sets `reveal`; a refresh clears it, so a settled turn never moves the reader's scroll.
  const reveal = file.reveal;
  useLayoutEffect(() => {
    if (reveal === null) return;
    rootRef.current?.querySelector(`[data-round="${reveal}"]`)?.scrollIntoView({ block: "start" });
  }, [reveal]);

  // The error takes the whole view only while there is nothing to take it from: this re-reads
  // on every settled turn now, so a blip mid-read would otherwise blank a file the user is in
  // the middle of. With a file already rendered the failure is a line above it.
  if (error !== null && analysis === null)
    return <p className={`text-xs ${toneInk.danger}`}>{error}</p>;
  if (!analysis) return <Skeleton className="h-40" />;

  const toggle = (ti: number) => {
    setFile((prev) => {
      const next = new Set(prev.expanded);
      if (next.has(ti)) next.delete(ti);
      else next.add(ti);
      return { ...prev, expanded: next };
    });
    // A failed read is not kept: closing and reopening the round is how it is retried.
    setRounds((prev) => {
      if (prev.get(ti)?.status !== "failed") return prev;
      const next = new Map(prev);
      next.delete(ti);
      return next;
    });
  };

  /** Click a bar: scroll to the corresponding message row and pin the highlight — the mouse moving away afterward shouldn't clear it, so this is stored separately from hover highlighting. */
  const jumpTo = (ts: string) => {
    const rk = firstRowKeyAt(rounds, expanded, ts);
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
    <TraceFileBody
      rootRef={rootRef}
      analysis={analysis}
      currency={currency}
      expanded={expanded}
      rounds={rounds}
      shownRounds={shownRounds}
      error={error}
      highlight={highlight}
      pinnedRow={pinnedRow}
      onHighlight={onHighlight}
      onToggle={toggle}
      onShowEarlier={() => setShownRounds((n) => n + TRACE_ROUNDS_PAGE)}
      onJump={jumpTo}
    />
  );
}

/**
 * The file as drawn from what the view holds: the analysis, which rounds are open, which have
 * been read. Separate from the loading so it renders to static markup with a given state.
 */
export function TraceFileBody({
  rootRef,
  analysis,
  currency,
  expanded,
  rounds,
  shownRounds,
  error,
  highlight,
  pinnedRow,
  onHighlight,
  onToggle,
  onShowEarlier,
  onJump,
}: {
  rootRef?: RefObject<HTMLDivElement | null>;
  analysis: TraceAnalysisResponse;
  currency: Currency;
  expanded: ReadonlySet<number>;
  rounds: ReadonlyMap<number, RoundEntry>;
  /** How many of the newest round cards are drawn. */
  shownRounds: number;
  /** A refresh that failed: what is drawn is the last read that succeeded. */
  error: string | null;
  highlight: TraceHighlight | null;
  pinnedRow: string | null;
  onHighlight: (h: TraceHighlight | null) => void;
  onToggle: (taskIndex: number) => void;
  onShowEarlier: () => void;
  onJump: (ts: string) => void;
}) {
  // Cost is not priced here: the analysis carries each round's cost (and the file's), priced by
  // the server with the cost center's own rule — the Project's current rates for the file's
  // model, at the tier each Request's timestamp fell in — so what this file adds up to is what
  // the conversation toolbar shows for the same requests. An unpriced model (or a legacy head
  // naming no provider) simply carries no cost, and formatMoney renders that as a dash.

  // Session context window (the upper bound for each round's donut ring): the analysis reads it
  // off the file's head session_meta; an older server sends none, and the ring falls back to 128000.
  const contextMax = resolveContextWindow(analysis.modelContextWindow);

  const { timelines, global, globalLlmMs } = useMemo(() => {
    const g = { buckets: zeroBuckets(), toolCalls: analysis.toolSpans.length };
    const byTask = new Map<number, TaskTimeline>();
    const ensure = (ti: number): TaskTimeline => {
      let d = byTask.get(ti);
      if (!d) {
        d = { segments: [], spans: [], otherSpans: [] };
        byTask.set(ti, d);
      }
      return d;
    };
    for (const s of analysis.modelSegments) ensure(s.taskIndex).segments.push(s);
    for (const s of analysis.toolSpans) ensure(s.taskIndex).spans.push(s);
    // Non-tool auxiliary phases (MCP connect); pre-otherSpans analysis payloads (cached
    // responses) may omit the field.
    for (const s of analysis.otherSpans ?? []) ensure(s.taskIndex).otherSpans.push(s);
    // Numeric values always come from analysis.tasks, computed by the server
    // over **the whole file** — never from the events, which are read one
    // open round at a time. Note the differing conventions:
    //   - context: a **snapshot** (usage at that round's last non-compaction Request), not an accumulated value;
    //   - tokens: this round's **throughput** (sum across Requests), used for
    //     Token / cost; `tokens.output` doubles as the TPS numerator;
    //   - llmMs: the TPS denominator (this round's LLM generation time, with human approval wait already deducted).
    // The global summary and the per-round cards below share **the same
    // scope** (including compaction rounds): every global figure is the sum
    // across rounds, and they must add up.
    for (const t of analysis.tasks) {
      g.buckets.cacheRead += t.tokens.cacheRead;
      g.buckets.cacheWrite += t.tokens.cacheWrite;
      g.buckets.output += t.tokens.output;
    }
    const gLlm = analysis.tasks.reduce((s, t) => s + t.llmMs, 0);
    return { timelines: byTask, global: g, globalLlmMs: gLlm };
  }, [analysis]);

  const shown = useMemo(() => visibleRounds(analysis.tasks, shownRounds), [analysis, shownRounds]);
  const earlier = analysis.tasks.length - shown.length;

  // Duration is likewise "the sum across rounds" computed by the server over
  // the whole file (including compaction rounds, same scope as the per-round
  // display below).
  const globalMs = analysis.elapsedMs;

  // Target row for hover highlighting: use the highlight's own rowKey (from a
  // message row) if it has one; otherwise, with only ts (from a bar), take the first row.
  const hoveredRow =
    highlight?.rowKey ??
    (highlight?.ts !== undefined ? firstRowKeyAt(rounds, expanded, highlight.ts) : null);

  return (
    <div ref={rootRef} className="space-y-4">
      {/* A re-read that failed: what follows is the last read that succeeded, so it may be a
          turn or two behind. */}
      {error !== null && <p className={`text-xs ${toneInk.danger}`}>{error}</p>}
      {/* Global summary: split into three groups by nature (count / Token
          usage / duration·cost·TPS), separated by vertical rules — a dozen
          metrics laid out in one row would read as a blur of digits; grouping lets you spot the kind you want at a glance. */}
      <Card>
        <CardHeader title={S.traces.globalSummary} />
        {/* Three groups side by side as columns, each item within a group
            taking its own row (name on the left, value on the right): laid
            out in one row it's a blur of digits, while giving each group a
            full row only uses a small strip on the left and wastes the rest.
            Splitting into columns fills the width and keeps it to three rows tall. */}
        <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-3">
          {/* Counts */}
          <div>
            {/* Rounds = every round in the file (a compaction round counts as
                a round too), drawn or not: the global summary and the per-round
                cards share **the same scope** — every figure is the sum across
                rounds and must add up. The average is exactly the two rows above
                it divided, tool calls ÷ rounds, so it holds that same scope and a
                reader can check the division by eye — a denominator that skipped
                compaction rounds would no longer match the round count printed here. */}
            <SummaryRow label={S.traces.tasksLabel} value={String(analysis.tasks.length)} />
            <SummaryRow label={S.traces.toolCalls} value={String(global.toolCalls)} />
            <SummaryRow
              label={S.traces.avgToolCalls}
              value={formatAverage(global.toolCalls, analysis.tasks.length)}
            />
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
              label={S.common.cost}
              value={formatMoney(analysis.cost ?? null, currency)}
            />
            <SummaryRow
              label={S.chat.statElapsed}
              value={humanizeDuration(Math.max(0, globalMs))}
              detail={durationSplit(analysis.apiMs, analysis.toolMs)}
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
      </Card>

      {/* The rounds before the drawn ones: each click draws the next page of them above. */}
      {earlier > 0 && (
        <button
          type="button"
          data-slot="earlier"
          onClick={onShowEarlier}
          className="w-full rounded-md py-1 text-center text-xs text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800/60 dark:hover:text-gray-200"
        >
          {S.traces.earlierRounds(earlier)}
        </button>
      )}

      {/* Grouped by Task */}
      {shown.map((st) => {
        const open = expanded.has(st.taskIndex);
        const timeline = timelines.get(st.taskIndex);
        // A round's duration range always comes from the server (computed over
        // the whole file; the start is that round's first request_begin). For a
        // degenerate round with no Request, startTs is an empty string → the
        // duration counts as 0.
        const startMs = Date.parse(st.startTs);
        const endMs = Date.parse(st.endTs);
        const durationMs =
          Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, endMs - startMs) : 0;
        // This round's convention as computed by the server over the whole
        // file: ctx = context snapshot at the end of this round (last
        // non-compaction Request), tokens = this round's throughput (used
        // for Token and cost, output doubles as the TPS numerator), llmMs = the TPS denominator.
        const ctx = st.context;
        const tokens = st.tokens;
        const compactionBadge = compactionBadgeLabel(st);
        return (
          // `data-round` is what a file's first open scrolls to; the margin keeps the card off
          // the panel's top edge once it is there.
          <Card key={st.taskIndex} padding="none" data-round={st.taskIndex} className="scroll-mt-3">
            <button
              type="button"
              data-slot="head"
              onClick={() => onToggle(st.taskIndex)}
              aria-expanded={open}
              className="flex w-full items-center gap-2 bg-gray-50 px-3 py-2 text-left transition-colors duration-150 hover:bg-gray-100 dark:bg-gray-900 dark:hover:bg-gray-800/60"
            >
              <Chevron open={open} size={13} className="text-gray-400" />
              <span className="shrink-0 text-sm font-semibold">
                {S.traces.task(st.taskIndex + 1)}
              </span>
              {/* Compaction rounds are explicitly flagged: their Token /
                  cost / duration / TPS count toward the global summary just
                  like user rounds do, and this badge answers "this round isn't answering the
                  user, it's housekeeping" — naming which housekeeping, since a discard round
                  clears the context rather than compacting it. */}
              {compactionBadge !== null && (
                <span className="shrink-0">
                  <Badge size="sm">{compactionBadge}</Badge>
                </span>
              )}
              <span className="min-w-0 flex-1" />
              {/* This round's stats: iconified in the top-right corner (hover gives a text explanation) */}
              <div
                className={`flex flex-wrap items-center justify-end gap-x-3 gap-y-1 ${CHIP_ROW_CLASS}`}
              >
                <StatChip
                  glyph={STAT_ICONS.toolCalls}
                  value={String(timeline?.spans.length ?? 0)}
                  label={S.traces.toolCalls}
                />
                {/* Token usage broken down by category: this round's input
                    (parenthesized portion is the cache hit) + this round's
                    output. Uses the server's this-round throughput tokens (whole file, including compaction). */}
                <InputChip buckets={tokens} />
                <StatChip
                  glyph={STAT_ICONS.output}
                  value={humanizeTokens(tokens.output)}
                  label={S.traces.taskOutput}
                />
                <StatChip
                  glyph={STAT_ICONS.cost}
                  value={formatMoney(st.cost ?? null, currency)}
                  label={`${S.common.cost}（${currency}）`}
                />
                <StatChip
                  glyph={STAT_ICONS.elapsed}
                  value={humanizeDuration(durationMs)}
                  label={`${S.chat.statElapsed}${durationSplit(st.llmMs, st.toolMs)}`}
                />
                <StatChip
                  glyph={STAT_ICONS.tps}
                  value={formatTps(computeTps(tokens.output, st.llmMs))}
                  label={S.chat.statTps}
                />
              </div>
              {/* Context-usage donut ring at the end of this round (upper
                  bound = the session context window) + the three-segment
                  composition, with exact numbers on hover (see TokenDonut's
                  title). The exact figures are given by the chips on the
                  left; the ring is only a peripheral hint of the usage
                  ratio, hence its small size. It's fed the snapshot ctx
                  rather than the accumulated tokens — the latter
                  recounts the history each round carries forward, so a few
                  rounds of tool calls alone could fill the ring. A pure compaction Task has no snapshot and draws no ring. */}
              {ctx && (
                <TokenDonut
                  cacheRead={ctx.cacheRead}
                  cacheWrite={ctx.cacheWrite}
                  output={ctx.output}
                  max={contextMax}
                  size={22}
                  labels={{
                    usage: S.chat.contextUsage,
                    cacheRead: S.usage.colCacheRead,
                    cacheWrite: S.usage.colCacheWrite,
                    output: S.usage.colOutput,
                  }}
                  format={humanizeTokens}
                />
              )}
            </button>

            {open && (
              <div data-slot="body" className="space-y-3 p-3">
                {/* This round's timeline: drawn from the analysis, so it is there before the messages are read. */}
                {timeline !== undefined &&
                  (timeline.segments.length > 0 ||
                    timeline.spans.length > 0 ||
                    timeline.otherSpans.length > 0) && (
                    <div className="rounded-md border border-gray-100 p-2 dark:border-gray-800/60">
                      <p className="mb-1.5 text-xs font-medium text-gray-500">
                        {S.traces.timeline}
                      </p>
                      <TimelineChart
                        segments={timeline.segments}
                        toolSpans={timeline.spans}
                        otherSpans={timeline.otherSpans}
                        highlight={highlight}
                        onHighlight={onHighlight}
                        onJump={onJump}
                        hideTaskLabel
                      />
                    </div>
                  )}

                {/* This round's messages */}
                <RoundMessages
                  round={st}
                  entry={rounds.get(st.taskIndex)}
                  hoveredRow={hoveredRow}
                  pinnedRow={pinnedRow}
                  onHighlight={onHighlight}
                />
              </div>
            )}
          </Card>
        );
      })}
    </div>
  );
}

/**
 * An open round's messages: its rows once read, a placeholder while the first read is out,
 * and the failure in their place when it did not come back. A re-read of a round already read
 * keeps the rows on screen until it lands.
 */
function RoundMessages({
  round,
  entry,
  hoveredRow,
  pinnedRow,
  onHighlight,
}: {
  round: TraceTaskStats;
  entry: RoundEntry | undefined;
  hoveredRow: string | null;
  pinnedRow: string | null;
  onHighlight: (h: TraceHighlight | null) => void;
}) {
  // Before the read lands the count is the range's, known from the analysis alone.
  const count = entry?.status === "loaded" ? entry.rows.length : roundSpan(round);
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-gray-500">
        {S.traces.messages}（{count}）
      </p>
      {entry === undefined ? (
        count === 0 ? (
          <p className="text-xs text-gray-400">{S.common.none}</p>
        ) : (
          <div role="status" aria-busy="true" className="space-y-1.5">
            <span className="sr-only">{S.traces.roundLoading}</span>
            {Array.from({ length: Math.min(3, count) }, (_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        )
      ) : entry.status === "failed" ? (
        <p className={`text-xs ${toneInk.danger}`}>{entry.error}</p>
      ) : entry.rows.length === 0 ? (
        <p className="text-xs text-gray-400">{S.common.none}</p>
      ) : (
        <ul className="divide-y divide-gray-100 rounded-md border border-gray-200 dark:divide-gray-800/60 dark:border-gray-800">
          {entry.rows.map((msg, i) => {
            const rk = rowKeyOf(round.taskIndex, i);
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
  );
}
