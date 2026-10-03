/**
 * Trace file view: one Trace file grouped by **round (Task)**, under the panel's sticky toolbar
 * (trace-toolbar.tsx — the file, the rounds button, the export). Two ruled sections follow: the
 * **global summary** at the top, then the **rounds** as ruled rows. A round's row is one line:
 * its number, its compaction badge, four readings — tool calls, cache hit rate, cost, duration
 * (round-facts.tsx) — and the **context ring** at its end (upper bound = the session's context
 * window, default 128000; the three segments are cacheRead / cacheWrite / output). The ring is a
 * button: its panel lists the exact figures (round-readings.tsx), and no token figure is printed
 * on the row or in the round's body. Opened, the round shows its execution timeline and all of
 * its messages, one pill per record toned by its family; the Session's own fields are the
 * `session_meta` row's, the first row of round 1. A `request_begin` row where the thinking level
 * changes says so in its summary (trace-levels.ts).
 *
 * The rounds button names the round in view (round-in-view.ts, re-read on the scroll box's
 * scroll) and opens the navigator over every round (trace-round-nav.tsx); a jump draws, opens
 * and scrolls to the round, landing its head just under the toolbar.
 *
 * Loading is per round: opening a file reads only its analysis — every number on the panel and
 * every round's message index range — and the file's newest round is open, read and scrolled
 * into view. The other rounds show their readings collapsed; opening one reads that round's
 * range alone (trace-rounds.ts). Round rows are drawn from the newest end, TRACE_ROUNDS_PAGE at
 * a time, behind an "earlier rounds" control, so a file of thousands of rounds is still a short
 * list.
 *
 * Token usage is **broken down by category** rather than given as one lump sum (a total alone
 * doesn't show where the money went): input, the portion that was a **cache hit**, output, plus
 * tool-call count / hit rate / cost / duration / output TPS. A round shows totals only; the
 * global summary adds, behind a "?" beside each, the cost's priced parts and the duration's API /
 * tool components. The conversation page's stats row only gives input/output totals — cache
 * composition and this kind of debugging detail belongs here. Every figure, cost included, is
 * the server's: the analysis prices each round with the cost center's rule, so the file's total
 * is what the toolbar shows for the same requests.
 *
 * Task attribution: model segments/tool spans carry their own taskIndex (computed by the
 * server), and a round's messages are the events in its server-given index range. Timeline ↔
 * message linked highlighting: hovering either side highlights the other (only one bar / one
 * message lights up at a time); clicking a bar scrolls to the corresponding message and pins the
 * highlight for PIN_MS.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import type { AmspRecord } from "@prismshadow/amsp";
import type {
  TraceAnalysisResponse,
  TraceModelSegment,
  TraceOtherSpan,
  TraceTaskStats,
  TraceToolSpan,
} from "@prismshadow/penguin-server/api";
import {
  Chevron,
  Fold,
  ICON_SIZE,
  InfoPopover,
  Pill,
  RuledSection,
  Skeleton,
  Text,
} from "@prismshadow/penguin-ui";
import * as api from "../../api/endpoints";
import { CostPartsRows, ElapsedSplitRows, StatHint } from "../../components/ui/stat-hint";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import {
  computeTps,
  formatAverage,
  formatMoney,
  formatPercent,
  formatTps,
  humanizeDuration,
  humanizeTokens,
} from "../../lib/format";
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
import { RoundFacts, hitRateOf, inputOf, roundFactsOf } from "./round-facts";
import type { Buckets } from "./round-facts";
import { ContextRingButton } from "./round-readings";
import { roundInView } from "./round-in-view";
import { ROUND_NAV_MIN_ROUNDS, RoundNavButton } from "./trace-round-nav";
import { TraceToolbar } from "./trace-toolbar";
import { levelChangeText, thinkingLevelChanges } from "./trace-levels";
import type { LevelChanges } from "./trace-levels";

/**
 * Badge text for a round row, or null when the round is not a compaction turn.
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
 * The three Token buckets (token_usage.request), zeroed. No `total` field: usage is always shown
 * broken down, and the total = input (cacheRead + cacheWrite) + output — there's no second
 * convention.
 */
const zeroBuckets = (): Buckets => ({ cacheRead: 0, cacheWrite: 0, output: 0 });

/** A round's timeline as the analysis gives it: everything a round draws without reading events. */
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
  | (RoundRange & { status: "loaded"; rows: AmspRecord[] })
  | (RoundRange & { status: "failed"; error: string });

/** How long the target message row stays pinned highlighted after a bar-click jump (milliseconds). */
const PIN_MS = 2500;

/** Unique key for a message row (also the DOM scroll anchor). */
const rowKeyOf = (taskIndex: number, i: number): string => `${taskIndex}-${i}`;

const isMainSession = (msg: AmspRecord): boolean => !(msg.origin && msg.origin.length > 0);

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
 * `hint` is the breakdown of the value (the cost's priced parts, the elapsed time's two
 * components), behind a "?" right of it. Not a hover hint on the row: a hint opens only where
 * the text is cut off or absent, so one on a fully visible value would never show. The slot
 * after the value is on every row, empty where there is no breakdown and as wide as the "?",
 * so the values of a column stay right-aligned with or without one.
 */
function SummaryRow({ label, value, hint }: { label: string; value: string; hint?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-0.5">
      <span className="shrink-0 text-xs text-gray-400">{label}</span>
      <span className="flex min-w-0 items-center gap-1">
        <span className="truncate font-mono text-sm font-semibold tabular-nums">{value}</span>
        <span className="flex shrink-0" style={{ width: ICON_SIZE.inlineGlyph }}>
          {hint !== undefined && <StatHint label={label}>{hint}</StatHint>}
        </span>
      </span>
    </div>
  );
}

/** Where focus lands once the next commit is drawn: a round's head after a jump; `seq` makes a second jump to the same round land again. */
interface FocusTarget {
  taskIndex: number;
  seq: number;
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
  toolbarStart,
  toolbarEnd,
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
  /** The toolbar's start: the panel's file picker or file label. */
  toolbarStart?: ReactNode;
  /** The toolbar's end: the panel's export control. */
  toolbarEnd?: ReactNode;
}) {
  const { currency } = useTheme();
  const [file, setFile] = useState<FileState>(EMPTY_FILE);
  const [rounds, setRounds] = useState<ReadonlyMap<number, RoundEntry>>(new Map());
  const [shownRounds, setShownRounds] = useState(TRACE_ROUNDS_PAGE);
  const [error, setError] = useState<string | null>(null);
  /** Message row pinned highlighted after a bar-click jump; auto-clears when its timer fires (independent of hover highlighting, and can stack with it). */
  const [pinnedRow, setPinnedRow] = useState<string | null>(null);
  /** The round in view under the toolbar; null before the panel has scrolled (the newest round, which the file opens on). */
  const [inView, setInView] = useState<number | null>(null);
  const [focusTarget, setFocusTarget] = useState<FocusTarget | null>(null);
  const focusSeq = useRef(0);
  /** The last focus target landed on: a later commit does not land it again. */
  const landedSeq = useRef(0);
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
    setInView(null);
    setFocusTarget(null);
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

  // Opening a file brings its open newest round into view: it is the last row, under the
  // global summary and the collapsed rounds drawn before it, so without this the panel opens on
  // everything but the round it just opened. The row's top goes to just under the toolbar (its
  // scroll margin), so its body — still being read — unfolds below it without moving it.
  // Instant, not smooth: a smooth scroll would sweep past every row above it. Only the analysis
  // that opened the file sets `reveal`; a refresh clears it, so a settled turn never moves the
  // reader's scroll.
  const reveal = file.reveal;
  useLayoutEffect(() => {
    if (reveal === null) return;
    rootRef.current?.querySelector(`[data-round="${reveal}"]`)?.scrollIntoView({ block: "start" });
  }, [reveal]);

  // A jump from the navigator brings the round's row to just under the toolbar and focuses its
  // toggle. Instant, like the reveal: a smooth jump across hundreds of rows would sweep past all
  // of them. The row is drawn and opened in the same commit as the request.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (focusTarget === null || root === null || focusTarget.seq === landedSeq.current) return;
    const row = root.querySelector(`[data-round="${focusTarget.taskIndex}"]`);
    if (row === null) return;
    row.scrollIntoView({ block: "start" });
    row.querySelector<HTMLElement>('[data-slot="toggle"]')?.focus({ preventScroll: true });
    landedSeq.current = focusTarget.seq;
  }, [focusTarget]);

  // The round in view follows the panel's scroll: on each scroll of the panel's scroll box (once
  // per frame), the drawn rows are measured against the toolbar's bottom edge and the box's own,
  // and the box's position against its end.
  useEffect(() => {
    const root = rootRef.current;
    const box = root?.closest("[data-scroll-box]");
    if (!root || !box) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const frameBox = box.getBoundingClientRect();
      const line =
        root.querySelector('[data-slot="toolbar"]')?.getBoundingClientRect().bottom ?? frameBox.top;
      const rows = [...root.querySelectorAll<HTMLElement>("[data-round]")].map((row) => {
        const rect = row.getBoundingClientRect();
        const head = row.querySelector('[data-slot="head"]')?.getBoundingClientRect();
        return {
          taskIndex: Number(row.dataset.round),
          top: rect.top,
          bottom: rect.bottom,
          headHeight: head?.height ?? rect.height,
        };
      });
      // A pixel of slack: a fractional scroll position never quite reaches the end.
      const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 1;
      setInView(roundInView(rows, { line, bottom: frameBox.bottom, atEnd }));
    };
    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    box.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      box.removeEventListener("scroll", onScroll);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, []);

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

  /**
   * A navigator row or the number box: draw the rows down to this round (they page from the
   * newest end), open it, and land on its head.
   */
  const jumpToRound = (taskIndex: number) => {
    if (analysis === null) return;
    const order = [...analysis.tasks].sort((a, b) => a.taskIndex - b.taskIndex);
    const position = order.findIndex((t) => t.taskIndex === taskIndex);
    if (position < 0) return;
    setShownRounds((n) => Math.max(n, order.length - position));
    setFile((prev) =>
      prev.expanded.has(taskIndex)
        ? prev
        : { ...prev, expanded: new Set(prev.expanded).add(taskIndex) },
    );
    // The jump lands this round under the toolbar; the scroll it causes measures the same.
    setInView(taskIndex);
    focusSeq.current += 1;
    setFocusTarget({ taskIndex, seq: focusSeq.current });
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
      inView={inView}
      onJumpToRound={jumpToRound}
      toolbarStart={toolbarStart}
      toolbarEnd={toolbarEnd}
    />
  );
}

/**
 * The file as drawn from what the view holds: the analysis, which rounds are open, which have
 * been read. Separate from the loading so it renders to static markup with a
 * given state. The toolbar is drawn in every state, so the file picker stays reachable while a
 * file loads or fails to.
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
  inView,
  onJumpToRound,
  toolbarStart,
  toolbarEnd,
}: {
  rootRef?: RefObject<HTMLDivElement | null>;
  /** null while the file's analysis is being read. */
  analysis: TraceAnalysisResponse | null;
  currency: Currency;
  expanded: ReadonlySet<number>;
  rounds: ReadonlyMap<number, RoundEntry>;
  /** How many of the newest round rows are drawn. */
  shownRounds: number;
  /** A read that failed: with an analysis on screen, what is drawn is the last read that succeeded. */
  error: string | null;
  highlight: TraceHighlight | null;
  pinnedRow: string | null;
  onHighlight: (h: TraceHighlight | null) => void;
  onToggle: (taskIndex: number) => void;
  onShowEarlier: () => void;
  /** A timeline bar was clicked: scroll to its message row. */
  onJump: (ts: string) => void;
  /** The round in view (the rounds button's label); null means the newest round. */
  inView: number | null;
  /** Draw, open and land on a round's row. */
  onJumpToRound: (taskIndex: number) => void;
  toolbarStart?: ReactNode;
  toolbarEnd?: ReactNode;
}) {
  // Cost is not priced here: the analysis carries each round's cost (and the file's), priced by
  // the server with the cost center's own rule — the Project's current rates for the file's
  // model, at the tier each Request's timestamp fell in — so what this file adds up to is what
  // the conversation toolbar shows for the same requests. An unpriced model (or a legacy head
  // naming no provider) simply carries no cost, and formatMoney renders that as a dash.

  // Session context window (the upper bound for each round's donut ring): the analysis reads it
  // off the file's head session_meta; an older server sends none, and the ring falls back to 128000.
  const contextMax = resolveContextWindow(analysis?.modelContextWindow);

  const { timelines, toolCallsByRound, global, globalLlmMs } = useMemo(() => {
    const g = { buckets: zeroBuckets(), toolCalls: analysis?.toolSpans.length ?? 0 };
    const byTask = new Map<number, TaskTimeline>();
    const ensure = (ti: number): TaskTimeline => {
      let d = byTask.get(ti);
      if (!d) {
        d = { segments: [], spans: [], otherSpans: [] };
        byTask.set(ti, d);
      }
      return d;
    };
    if (analysis !== null) {
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
      // The global summary and the per-round rows below share **the same
      // scope** (including compaction rounds): every global figure is the sum
      // across rounds, and they must add up.
      for (const t of analysis.tasks) {
        g.buckets.cacheRead += t.tokens.cacheRead;
        g.buckets.cacheWrite += t.tokens.cacheWrite;
        g.buckets.output += t.tokens.output;
      }
    }
    const gLlm = analysis?.tasks.reduce((s, t) => s + t.llmMs, 0) ?? 0;
    const calls = new Map<number, number>();
    for (const [ti, d] of byTask) calls.set(ti, d.spans.length);
    return { timelines: byTask, toolCallsByRound: calls, global: g, globalLlmMs: gLlm };
  }, [analysis]);

  // Where the thinking level changes: the request_begin rows that say so.
  const levelChanges = useMemo(() => thinkingLevelChanges(analysis?.requests ?? []), [analysis]);
  const allRounds = useMemo(
    () => (analysis === null ? [] : visibleRounds(analysis.tasks, analysis.tasks.length)),
    [analysis],
  );
  const shown = useMemo(
    () => (analysis === null ? [] : visibleRounds(analysis.tasks, shownRounds)),
    [analysis, shownRounds],
  );
  const earlier = allRounds.length - shown.length;
  const newest = allRounds.at(-1)?.taskIndex;

  // Target row for hover highlighting: use the highlight's own rowKey (from a
  // message row) if it has one; otherwise, with only ts (from a bar), take the first row.
  const hoveredRow =
    highlight?.rowKey ??
    (highlight?.ts !== undefined ? firstRowKeyAt(rounds, expanded, highlight.ts) : null);

  return (
    <div ref={rootRef}>
      <TraceToolbar
        start={toolbarStart}
        nav={
          allRounds.length >= ROUND_NAV_MIN_ROUNDS && newest !== undefined ? (
            <RoundNavButton
              tasks={allRounds}
              toolCalls={toolCallsByRound}
              badgeOf={compactionBadgeLabel}
              currency={currency}
              current={inView ?? newest}
              onJump={onJumpToRound}
            />
          ) : undefined
        }
        end={toolbarEnd}
      />

      {/* A read that failed. With an analysis on screen, what follows is the last read that
          succeeded, so it may be a turn or two behind; without one, it is all there is. */}
      {error !== null && <p className={`mb-3 text-xs ${toneInk.danger}`}>{error}</p>}

      {analysis === null ? (
        error === null && <Skeleton className="h-40" />
      ) : (
        <div className="space-y-6">
          {/* Global summary: split into three groups by nature (count / Token usage /
                duration·cost·TPS), each item within a group taking its own row (name on the
                left, value on the right) — a dozen metrics in one row would read as a blur of
                digits. Side by side only where the section itself has the room: it is the
                container queried, not the viewport, since the Trace tab is a dock panel a few
                hundred pixels wide on a wide screen. `@2xl` leaves each column about a third
                wider than its longest label and value need; narrower, the groups stack. */}
          <RuledSection level={3} title={S.traces.globalSummary} className="@container">
            <div className="grid grid-cols-1 gap-x-6 gap-y-4 @2xl:grid-cols-3">
              {/* Counts. Rounds = every round in the file (a compaction round counts as a
                    round too), drawn or not: the summary and the rows share **the same scope**.
                    The average is the two rows above it divided, so a reader can check it. */}
              <div>
                <SummaryRow label={S.traces.tasksLabel} value={String(analysis.tasks.length)} />
                <SummaryRow label={S.traces.toolCalls} value={String(global.toolCalls)} />
                <SummaryRow
                  label={S.traces.avgToolCalls}
                  value={formatAverage(global.toolCalls, analysis.tasks.length)}
                />
              </div>
              {/* Token usage: broken down by category (input / of which cache hit + hit rate / output), never given as a lump sum. */}
              <div>
                <SummaryRow
                  label={S.chat.statInput}
                  value={humanizeTokens(inputOf(global.buckets))}
                />
                <SummaryRow
                  label={S.traces.cacheHit}
                  value={`${humanizeTokens(global.buckets.cacheRead)} · ${formatPercent(hitRateOf(global.buckets))}`}
                />
                <SummaryRow
                  label={S.chat.statOutput}
                  value={humanizeTokens(global.buckets.output)}
                />
              </div>
              {/* Cost · duration · TPS (cost above duration, same order as the conversation
                    page's stats row). Cost and duration carry their breakdowns behind a "?": the
                    cost's priced parts whenever the file has a cost, the duration's two
                    components once either of them has any time. Global TPS = every round's
                    output ÷ the sum of LLM generation time, the same scope as the rest. */}
              <div>
                <SummaryRow
                  label={S.common.cost}
                  value={formatMoney(analysis.cost ?? null, currency)}
                  hint={
                    analysis.costParts !== undefined ? (
                      <CostPartsRows parts={analysis.costParts} currency={currency} />
                    ) : undefined
                  }
                />
                <SummaryRow
                  label={S.chat.statElapsed}
                  value={humanizeDuration(Math.max(0, analysis.elapsedMs))}
                  hint={
                    analysis.apiMs > 0 || analysis.toolMs > 0 ? (
                      <ElapsedSplitRows
                        apiMs={analysis.apiMs}
                        toolMs={analysis.toolMs}
                        totalMs={Math.max(0, analysis.elapsedMs)}
                      />
                    ) : undefined
                  }
                />
                <SummaryRow
                  label={S.chat.statTps}
                  value={formatTps(computeTps(global.buckets.output, globalLlmMs))}
                />
              </div>
            </div>
          </RuledSection>

          <RuledSection level={3} title={S.traces.tasksLabel} count={analysis.tasks.length}>
            {/* The rounds before the drawn ones: each click draws the next page of them above. */}
            {earlier > 0 && (
              <button
                type="button"
                data-slot="earlier"
                onClick={onShowEarlier}
                className="mb-1 w-full rounded-md py-1 text-center text-xs text-fg-muted transition-colors duration-150 hover:bg-control-hover hover:text-fg"
              >
                {S.traces.earlierRounds(earlier)}
              </button>
            )}
            <ol className="divide-y divide-line-muted">
              {shown.map((st) => (
                <RoundRow
                  key={st.taskIndex}
                  round={st}
                  open={expanded.has(st.taskIndex)}
                  timeline={timelines.get(st.taskIndex)}
                  entry={rounds.get(st.taskIndex)}
                  contextMax={contextMax}
                  currency={currency}
                  levelChanges={levelChanges}
                  highlight={highlight}
                  hoveredRow={hoveredRow}
                  pinnedRow={pinnedRow}
                  onHighlight={onHighlight}
                  onToggle={onToggle}
                  onJump={onJump}
                />
              ))}
            </ol>
          </RuledSection>
        </div>
      )}
    </div>
  );
}

/**
 * One round: a ruled row whose head is one line — the toggle (number, compaction badge, the four
 * readings, giving way at their tail) and the context ring after it, since a button holds no
 * other control — and, opened, the round's timeline and messages.
 */
function RoundRow({
  round: st,
  open,
  timeline,
  entry,
  contextMax,
  currency,
  levelChanges,
  highlight,
  hoveredRow,
  pinnedRow,
  onHighlight,
  onToggle,
  onJump,
}: {
  round: TraceTaskStats;
  open: boolean;
  timeline: TaskTimeline | undefined;
  entry: RoundEntry | undefined;
  contextMax: number;
  currency: Currency;
  levelChanges: LevelChanges;
  highlight: TraceHighlight | null;
  hoveredRow: string | null;
  pinnedRow: string | null;
  onHighlight: (h: TraceHighlight | null) => void;
  onToggle: (taskIndex: number) => void;
  onJump: (ts: string) => void;
}) {
  const compactionBadge = compactionBadgeLabel(st);
  return (
    // `data-round` is what a file's first open and a navigator jump scroll to; the scroll margin
    // is the sticky toolbar's height, so the head lands under the toolbar rather than behind it.
    <li data-round={st.taskIndex} className="scroll-mt-10">
      <div data-slot="head" className="flex items-center gap-1">
        <button
          type="button"
          data-slot="toggle"
          onClick={() => onToggle(st.taskIndex)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1.5 text-left whitespace-nowrap transition-colors duration-150 hover:bg-control-hover"
        >
          <Chevron open={open} size={ICON_SIZE.inlineGlyph} className="text-fg-subtle" />
          <span className="shrink-0 text-sm font-semibold">{S.traces.task(st.taskIndex + 1)}</span>
          {/* Compaction rounds are explicitly flagged: their Token / cost / duration / TPS count
              toward the global summary just like user rounds do, and this badge answers "this
              round isn't answering the user, it's housekeeping" — naming which housekeeping,
              since a discard round clears the context rather than compacting it. */}
          {compactionBadge !== null && (
            <span className="shrink-0">
              <Pill>{compactionBadge}</Pill>
            </span>
          )}
          {/* The four readings: totals only, no "?" — the breakdowns belong to the global
              summary's totals. */}
          <RoundFacts facts={roundFactsOf(st, timeline?.spans.length ?? 0)} currency={currency} />
        </button>
        {/* The context ring at the end of the round (the snapshot at its last request, not the
            accumulated tokens — those recount the history each round carries forward, so a few
            rounds of tool calls alone could fill the ring). Its figures are a click away. */}
        <ContextRingButton
          tokens={st.tokens}
          llmMs={st.llmMs}
          ctx={st.context}
          contextMax={contextMax}
        />
      </div>

      {/* The round's body folds under the theme's layout motion, and is built only while it
          shows: a round's timeline and its rows are the costly part of this page. */}
      <Fold open={open} data-slot="body" bodyClassName="space-y-4 pt-1 pb-4 sm:pl-6">
        {() => (
          <>
            {/* This round's timeline: drawn from the analysis, so it is there before the messages are read. */}
            {timeline !== undefined &&
              (timeline.segments.length > 0 ||
                timeline.spans.length > 0 ||
                timeline.otherSpans.length > 0) && (
                <div>
                  <Text
                    variant="eyebrow"
                    as="p"
                    className="mb-1.5 flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {S.traces.timeline}
                    <InfoPopover label={S.traces.timeline}>{S.traces.linkHint}</InfoPopover>
                  </Text>
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
              entry={entry}
              levelChanges={levelChanges}
              hoveredRow={hoveredRow}
              pinnedRow={pinnedRow}
              onHighlight={onHighlight}
            />
          </>
        )}
      </Fold>
    </li>
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
  levelChanges,
  hoveredRow,
  pinnedRow,
  onHighlight,
}: {
  round: TraceTaskStats;
  entry: RoundEntry | undefined;
  /** A `request_begin` row at a change point says so in its summary. */
  levelChanges: LevelChanges;
  hoveredRow: string | null;
  pinnedRow: string | null;
  onHighlight: (h: TraceHighlight | null) => void;
}) {
  // Before the read lands the count is the range's, known from the analysis alone.
  const count = entry?.status === "loaded" ? entry.rows.length : roundSpan(round);
  return (
    <div>
      <Text variant="eyebrow" as="p" className="mb-1.5">
        {S.traces.messages}（{count}）
      </Text>
      {entry === undefined ? (
        count === 0 ? (
          <p className="text-xs text-fg-subtle">{S.common.none}</p>
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
        <p className="text-xs text-fg-subtle">{S.common.none}</p>
      ) : (
        <ul className="divide-y divide-line-muted border-y border-line-muted">
          {entry.rows.map((msg, i) => {
            const rk = rowKeyOf(round.taskIndex, i);
            const change =
              (msg.payload as { type?: string }).type === "request_begin"
                ? levelChanges.byBeginTs.get(msg.timestamp)
                : undefined;
            return (
              <EventRow
                key={i}
                msg={msg}
                rowKey={rk}
                matched={rk === hoveredRow || rk === pinnedRow}
                onHighlight={(h) => onHighlight(h)}
                {...(change !== undefined
                  ? { summary: `thinking_level=${levelChangeText(change)}` }
                  : {})}
              />
            );
          })}
        </ul>
      )}
    </div>
  );
}
