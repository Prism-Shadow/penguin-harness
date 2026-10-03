/**
 * The Trace file view as drawn (features/traces/trace-file-view.tsx, `TraceFileBody`): what a
 * long file puts on screen once its analysis is in and its newest round is read. Rendered to
 * static markup, so each scenario hands the view the state it would hold.
 *
 * - A 1200-round file draws at most 50 round rows, and the messages of exactly one round — the
 *   open newest one.
 * - The rounds not drawn sit behind an "earlier rounds" control that names how many there are;
 *   one step draws 50 more; a file of fewer than 50 rounds has no such control.
 * - A collapsed round draws no messages, even when its events are held from an earlier opening.
 * - An open round whose read is still out draws a placeholder and no messages; one whose read
 *   failed says so in place of its messages.
 * - A round's head carries exactly four readings — tool calls, hit rate, cost, elapsed, in that
 *   order — then the context ring button, named by its usage percentage; a cut-off line's hint
 *   names all four readings. No token figure (input, cache hits, output, speed) is printed on a
 *   head or anywhere in an open round.
 * - A round with no context snapshot (pure compaction) gets a readings button in the ring's place.
 * - The ring's percentage is of the file's context window, and of 128k when the analysis (from an
 *   older server) carries none.
 * - A file of two or more rounds puts a rounds button in the toolbar naming the round in view —
 *   the newest one before the panel scrolls — and draws no navigator list until it is opened; a
 *   one-round file has no rounds button; no round head carries a control back to a navigator.
 * - Under the toolbar the first section is the global summary: the Session's fields are the
 *   session_meta row's, not a section of their own.
 * - Where the thinking level changes, the request_begin row's summary says so as text, the first
 *   level stated alone and a switch as `from → to`; a Trace written before the field says
 *   nothing, and no row wears a level pill.
 * - The timeline's explanation sits behind a "?" beside its title, not as a line under it.
 * - The global summary's cost and elapsed time each put their breakdown behind a "?"; no round
 *   row carries one.
 * - Opening a file asks once to scroll its newest round into view — the open round drawn last —
 *   and no refresh after it asks again, not even one that opens a new round for a reader
 *   following the run.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AmspRecord } from "@prismshadow/amsp";
import type {
  RequestSpan,
  TraceAnalysisResponse,
  TraceTaskStats,
} from "@prismshadow/penguin-server/api";
import { DEFAULT_UI_STRINGS } from "@prismshadow/penguin-ui";
import {
  EMPTY_FILE,
  TraceFileBody,
  fileAfterAnalysis,
} from "../src/features/traces/trace-file-view";
import type { FileState, RoundEntry } from "../src/features/traces/trace-file-view";
import { TRACE_ROUNDS_PAGE } from "../src/features/traces/trace-rounds";
import { S } from "../src/lib/strings";

/** Events per synthetic round: a prompt, a request, thinking, a tool call and its output, a reply… */
const PER_ROUND = 11;

const iso = (ms: number): string => new Date(Date.UTC(2026, 9, 1) + ms).toISOString();

/** A round's tokens: 32k input of which 30k cache hits, 1.2k output — figures no other text on the page spells. */
const TOKENS = { cacheRead: 30_000, cacheWrite: 2_000, output: 1_234 };

function round(k: number): TraceTaskStats {
  return {
    taskIndex: k,
    messageFrom: k * PER_ROUND,
    messageTo: (k + 1) * PER_ROUND - 1,
    startTs: iso(k * 60_000),
    endTs: iso(k * 60_000 + 20_000),
    context: { ...TOKENS },
    tokens: { ...TOKENS },
    llmMs: 12_000,
    toolMs: 5_000,
  };
}

function analysisOf(rounds: number, extra: Partial<TraceAnalysisResponse> = {}) {
  const tasks = Array.from({ length: rounds }, (_, k) => round(k));
  const newest = rounds - 1;
  const analysis: TraceAnalysisResponse = {
    elapsedMs: rounds * 20_000,
    apiMs: rounds * 12_000,
    toolMs: rounds * 5_000,
    requests: [],
    tasks,
    toolCalls: [],
    // The newest round has a timeline, as a real one does.
    modelSegments: [
      {
        kind: "thinking",
        startTs: iso(newest * 60_000),
        endTs: iso(newest * 60_000 + 4_000),
        taskIndex: newest,
      },
    ],
    toolSpans: [],
    otherSpans: [],
    reconnectCount: 0,
    compactionCount: 0,
    usageTrend: [],
    ...extra,
  };
  return analysis;
}

/** A round's events as read: one row per event in its range, alternating the user's and the model's texts. */
function readRound(r: TraceTaskStats): RoundEntry {
  const rows: AmspRecord[] = [];
  for (let i = r.messageFrom; i <= r.messageTo; i++) {
    rows.push({
      timestamp: iso(r.taskIndex * 60_000 + (i - r.messageFrom) * 1000),
      type: "model_msg",
      payload: {
        type: "text",
        role: i % 2 === 0 ? "user" : "assistant",
        text: `event ${i}`,
      },
    });
  }
  return {
    taskIndex: r.taskIndex,
    messageFrom: r.messageFrom,
    messageTo: r.messageTo,
    status: "loaded",
    rows,
  };
}

function render(opts: {
  analysis: TraceAnalysisResponse | null;
  expanded?: number[];
  rounds?: RoundEntry[];
  shownRounds?: number;
  inView?: number | null;
}): string {
  return renderToStaticMarkup(
    createElement(TraceFileBody, {
      analysis: opts.analysis,
      currency: "USD",
      expanded: new Set(opts.expanded ?? []),
      rounds: new Map((opts.rounds ?? []).map((e) => [e.taskIndex, e])),
      shownRounds: opts.shownRounds ?? TRACE_ROUNDS_PAGE,
      error: null,
      highlight: null,
      pinnedRow: null,
      onHighlight: () => {},
      onToggle: () => {},
      onShowEarlier: () => {},
      onJump: () => {},
      inView: opts.inView ?? null,
      onJumpToRound: () => {},
    }),
  );
}

const count = (html: string, re: RegExp): number => [...html.matchAll(re)].length;
const heads = (html: string): number => count(html, /data-slot="head"/g);
const earlierControls = (html: string): number => count(html, /data-slot="earlier"/g);
/** The rounds whose messages are on screen, by taskIndex (a row's key is `<taskIndex>-<i>`). */
const rowGroups = (html: string): number[] => [
  ...new Set([...html.matchAll(/data-trace-row="(\d+)-\d+"/g)].map((m) => Number(m[1]))),
];
const rows = (html: string): number => count(html, /data-trace-row="/g);
/** The markup of the round rows, past the toolbar and the sections above them. */
const roundRows = (html: string): string => html.slice(html.indexOf("data-round="));
/** One round's row: from its `data-round` to the next round's. */
function rowOf(html: string, k: number): string {
  const start = html.indexOf(`data-round="${k}"`);
  const next = html.indexOf("data-round=", start + 1);
  return html.slice(start, next < 0 ? undefined : next);
}
/** A round's head: the row up to its body. */
function headOf(html: string, k: number): string {
  const row = rowOf(html, k);
  const body = row.indexOf('data-slot="body"');
  return body < 0 ? row : row.slice(0, body);
}
/** The toolbar's markup: up to the first section under it. */
function toolbarOf(html: string): string {
  const start = html.indexOf('data-slot="toolbar"');
  return html.slice(start, html.indexOf("<section", start));
}
/** The accessible names in a piece of markup, in order. */
const names = (html: string): string[] =>
  [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]!);
/** The ring button's accessible name in a piece of markup. */
const ringName = (html: string): string | undefined =>
  /data-slot="ring" aria-label="([^"]*)"/.exec(html)?.[1];

describe("a long Trace file", () => {
  const analysis = analysisOf(1200);
  const newest = analysis.tasks[1199]!;

  it("draws at most 50 round rows, and the messages of the one open round", () => {
    const html = render({ analysis, expanded: [1199], rounds: [readRound(newest)] });

    expect(heads(html)).toBeLessThanOrEqual(50);
    expect(rowGroups(html)).toEqual([1199]);
    expect(rows(html)).toBe(PER_ROUND);
  });

  it("puts the rounds not drawn behind one control that names them, and a step draws 50 more", () => {
    const first = render({ analysis, expanded: [1199], rounds: [readRound(newest)] });
    expect(earlierControls(first)).toBe(1);
    expect(first).toContain(S.traces.earlierRounds(1150));

    const stepped = render({
      analysis,
      expanded: [1199],
      rounds: [readRound(newest)],
      shownRounds: 2 * TRACE_ROUNDS_PAGE,
    });
    expect(heads(stepped)).toBe(100);
    expect(stepped).toContain(S.traces.earlierRounds(1100));
  });

  it("a file of fewer rounds than a page has no earlier-rounds control", () => {
    const html = render({ analysis: analysisOf(30), expanded: [29] });
    expect(heads(html)).toBe(30);
    expect(earlierControls(html)).toBe(0);
  });

  it("a collapsed round draws no messages, even with its events held from an earlier opening", () => {
    const html = render({ analysis, expanded: [], rounds: [readRound(newest)] });

    expect(rows(html)).toBe(0);
    expect(roundRows(html)).not.toMatch(/data-slot="toggle"[^>]*aria-expanded="true"/);
  });

  it("an open round still being read draws a placeholder and no messages", () => {
    const html = render({ analysis, expanded: [1199] });

    expect(rows(html)).toBe(0);
    expect(roundRows(html)).toContain('role="status"');
    expect(html).toContain(S.traces.roundLoading);
  });

  it("an open round whose read failed says so in place of its messages", () => {
    const failed: RoundEntry = {
      taskIndex: 1199,
      messageFrom: newest.messageFrom,
      messageTo: newest.messageTo,
      status: "failed",
      error: "The Trace file could not be read.",
    };
    const html = render({ analysis, expanded: [1199], rounds: [failed] });

    expect(rows(html)).toBe(0);
    expect(html).toContain("The Trace file could not be read.");
  });
});

describe("a round's readings", () => {
  const analysis = analysisOf(3, { cost: 0.0036, modelContextWindow: 200_000 });
  const html = render({ analysis, expanded: [2], rounds: [readRound(analysis.tasks[2]!)] });

  it("the head carries tool calls, hit rate, cost and elapsed, in that order, then the context ring", () => {
    expect(names(headOf(html, 0))).toEqual([
      S.traces.toolCalls,
      S.traces.hitRate,
      `${S.common.cost}（USD）`,
      S.chat.statElapsed,
      `${S.chat.contextUsage} 17%`,
    ]);
  });

  it("no token figure is printed on a head or in an open round", () => {
    // 32k input, 30k cache hits, 1.2k output, and any speed: all behind the ring's click.
    const figures = /\b32k\b|\b30k\b|\b1\.2k\b|tok\/s/;
    expect(headOf(html, 0)).not.toMatch(figures);
    expect(rowOf(html, 2)).not.toMatch(figures);
  });

  it("a cut-off head names all four readings in its hint", () => {
    const hint = /data-slot="facts" data-tooltip="([^"]*)"/.exec(headOf(html, 0))?.[1] ?? "";
    for (const label of [S.traces.toolCalls, S.traces.hitRate, S.common.cost, S.chat.statElapsed]) {
      expect(hint).toContain(label);
    }
    expect(hint).toContain("94%");
  });

  it("a round with no context snapshot gets a readings button where the ring would be", () => {
    const compaction = analysisOf(2);
    const { context: _snapshot, ...summary } = compaction.tasks[1]!;
    compaction.tasks[1] = { ...summary, compaction: true };
    const markup = render({ analysis: compaction });
    expect(ringName(headOf(markup, 1))).toBe(S.traces.roundReadings);
    expect(ringName(headOf(markup, 0))).toBe(`${S.chat.contextUsage} 26%`);
  });
});

describe("the context ring", () => {
  // 33.2k used: 17% of a 200k window, 26% of the 128k fallback.
  it("is a share of the file's context window", () => {
    const html = render({ analysis: analysisOf(3, { modelContextWindow: 200_000 }) });
    expect(ringName(headOf(html, 0))).toBe(`${S.chat.contextUsage} 17%`);
  });

  it("falls back to 128k when the analysis carries no window", () => {
    const html = render({ analysis: analysisOf(3) });
    expect(ringName(headOf(html, 0))).toBe(`${S.chat.contextUsage} 26%`);
  });
});

describe("the rounds button", () => {
  const navButton = (html: string): string | undefined =>
    /data-slot="nav-button"[^>]*>(.*?)<\/button>/.exec(toolbarOf(html))?.[1];

  it("names the newest round before the panel scrolls, and the round in view after", () => {
    const analysis = analysisOf(60);
    expect(navButton(render({ analysis }))).toContain(S.traces.task(60));
    expect(navButton(render({ analysis, inView: 20 }))).toContain(S.traces.task(21));
  });

  it("lists nothing until it is opened, and no round head carries a way back to a navigator", () => {
    const html = render({ analysis: analysisOf(60), expanded: [59] });
    expect(html).not.toContain("data-pick-row");
    // A head holds its toggle and its ring, and nothing else.
    for (let k = 10; k < 60; k++) expect(count(headOf(html, k), /<button/g)).toBe(2);
  });

  it("a one-round file has no rounds button", () => {
    const html = render({ analysis: analysisOf(1), expanded: [0] });
    expect(navButton(html)).toBeUndefined();
  });
});

describe("the top of the view", () => {
  it("is the global summary, the first section under the toolbar", () => {
    const html = render({ analysis: analysisOf(2) });
    const titles = [...html.matchAll(/<h3[^>]*><span[^>]*>([^<]*)</g)].map((m) => m[1]);
    expect(titles).toEqual([S.traces.globalSummary, S.traces.tasksLabel]);
  });
});

describe("the thinking level", () => {
  /** A round whose read rows include its request_begin, at the time its span begins. */
  function readWithRequest(r: TraceTaskStats, beginTs: string, level?: string): RoundEntry {
    const entry = readRound(r);
    if (entry.status !== "loaded") throw new Error("unreachable");
    entry.rows[1] = {
      timestamp: beginTs,
      type: "event_msg",
      payload: { type: "request_begin", ...(level !== undefined ? { thinking_level: level } : {}) },
    } as AmspRecord;
    return entry;
  }
  const beginOf = (k: number): string => iso(k * 60_000 + 1000);
  const span = (k: number, level?: string): RequestSpan => ({
    beginTs: beginOf(k),
    taskIndex: k,
    ...(level !== undefined ? { thinkingLevel: level } : {}),
  });

  it("a request row says where the level is first stated and where it switches, as text", () => {
    const levels = ["medium", "medium", "high"];
    const analysis = analysisOf(3, { requests: levels.map((l, k) => span(k, l)) });
    const html = render({
      analysis,
      expanded: [0, 1, 2],
      rounds: levels.map((l, k) => readWithRequest(analysis.tasks[k]!, beginOf(k), l)),
    });

    expect(rowOf(html, 0)).toContain(">thinking_level=medium<");
    expect(rowOf(html, 1)).toContain(">thinking_level=medium<");
    expect(rowOf(html, 2)).toContain(">thinking_level=medium → high<");
    // A level is text on the row, never a pill wearing its display name.
    for (const name of [S.chat.thinkingLevelNames.medium!, S.chat.thinkingLevelNames.high!]) {
      expect(html).not.toContain(`>${name}<`);
    }
  });

  it("a Trace written before the field says nothing about a level", () => {
    const analysis = analysisOf(3, { requests: [span(0), span(1), span(2)] });
    const html = render({
      analysis,
      expanded: [2],
      rounds: [readWithRequest(analysis.tasks[2]!, beginOf(2))],
    });
    expect(html).not.toContain("thinking_level=");
  });
});

describe("an open round's body", () => {
  it('explains the timeline behind a "?" beside its title, not in a line under it', () => {
    const analysis = analysisOf(3);
    const html = render({ analysis, expanded: [2], rounds: [readRound(analysis.tasks[2]!)] });
    expect(rowOf(html, 2)).toContain(DEFAULT_UI_STRINGS.moreInfoAbout(S.traces.timeline));
    expect(html).not.toContain(S.traces.linkHint);
  });
});

describe("the global summary", () => {
  it('gives the cost and the elapsed time a "?" each, and no round row one', () => {
    const costParts = { cacheRead: 0.1, cacheWrite: 0.12, output: 0.2 };
    const html = render({ analysis: analysisOf(3, { cost: 0.42, costParts }), expanded: [] });

    expect(html).toContain(DEFAULT_UI_STRINGS.moreInfoAbout(S.common.cost));
    expect(html).toContain(DEFAULT_UI_STRINGS.moreInfoAbout(S.chat.statElapsed));
    // Three round rows are drawn, and the two marks above are every "?" on the page.
    expect(heads(html)).toBe(3);
    expect(count(html, new RegExp(`aria-label="${DEFAULT_UI_STRINGS.moreInfo}`, "g"))).toBe(2);
  });
});

describe("opening a file", () => {
  /** The view's state after each analysis in turn, from a file it has not shown yet. */
  const statesAfter = (...analyses: TraceAnalysisResponse[]): FileState[] => {
    const states: FileState[] = [];
    let state = EMPTY_FILE;
    for (const a of analyses) {
      state = fileAfterAnalysis(state, a);
      states.push(state);
    }
    return states;
  };
  /** The scroll requests a run of analyses makes: the view scrolls whenever `reveal` is set. */
  const scrollRequests = (states: FileState[]): number[] =>
    states.flatMap((s) => (s.reveal === null ? [] : [s.reveal]));

  it("scrolls the open newest round into view once, on the first analysis only", () => {
    const states = statesAfter(
      analysisOf(1200),
      // A turn settles inside the newest round, then a new round starts: both are refreshes.
      analysisOf(1200),
      analysisOf(1201),
    );

    expect(scrollRequests(states)).toEqual([1199]);
    // The refresh still follows the run: the reader was on the newest round, so the new one opens.
    expect([...states[2]!.expanded].sort((a, b) => a - b)).toEqual([1199, 1200]);
  });

  it("the round it scrolls to is the last row drawn, and the open one", () => {
    const [opened] = statesAfter(analysisOf(1200));
    const html = render({ analysis: opened!.analysis!, expanded: [...opened!.expanded] });

    const drawn = [...html.matchAll(/data-round="(\d+)"/g)].map((m) => Number(m[1]));
    expect(drawn.at(-1)).toBe(opened!.reveal);
    expect(headOf(html, opened!.reveal!)).toMatch(/data-slot="toggle"[^>]*aria-expanded="true"/);
    expect(count(roundRows(html), /data-slot="toggle"[^>]*aria-expanded="true"/g)).toBe(1);
  });

  it("a file with no round yet scrolls nowhere until its first round appears", () => {
    expect(scrollRequests(statesAfter(analysisOf(0), analysisOf(0), analysisOf(1)))).toEqual([0]);
  });
});
