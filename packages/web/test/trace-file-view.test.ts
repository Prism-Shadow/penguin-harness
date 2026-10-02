/**
 * The Trace file view as drawn (features/traces/trace-file-view.tsx, `TraceFileBody`): what a
 * long file puts on screen once its analysis is in and its newest round is read. Rendered to
 * static markup, so each scenario hands the view the state it would hold.
 *
 * - A 1200-round file draws at most 50 round heads, and the rows of exactly one round — the
 *   open newest one.
 * - The rounds not drawn sit behind an "earlier rounds" control that names how many there are;
 *   one step draws 50 more; a file of fewer than 50 rounds has no such control.
 * - A collapsed round draws no rows, even when its events are held from an earlier opening.
 * - An open round whose read is still out draws a placeholder and no rows; one whose read
 *   failed says so in place of its rows.
 * - Each round's context ring is bounded by the file's context window, and by 128k when the
 *   analysis (from an older server) carries none.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type { TraceAnalysisResponse, TraceTaskStats } from "@prismshadow/penguin-server/api";
import { TraceFileBody } from "../src/features/traces/trace-file-view";
import type { RoundEntry } from "../src/features/traces/trace-file-view";
import { TRACE_ROUNDS_PAGE } from "../src/features/traces/trace-rounds";
import { humanizeTokens } from "../src/lib/format";
import { S } from "../src/lib/strings";

/** Events per synthetic round: a prompt, a request, thinking, a tool call and its output, a reply… */
const PER_ROUND = 11;

const iso = (ms: number): string => new Date(Date.UTC(2026, 9, 1) + ms).toISOString();

function round(k: number): TraceTaskStats {
  return {
    taskIndex: k,
    messageFrom: k * PER_ROUND,
    messageTo: (k + 1) * PER_ROUND - 1,
    startTs: iso(k * 60_000),
    endTs: iso(k * 60_000 + 20_000),
    context: { cacheRead: 30_000, cacheWrite: 2_000, output: 1_000 },
    tokens: { cacheRead: 30_000, cacheWrite: 2_000, output: 1_000 },
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

/** A round's events as read: one row per event in its range. */
function readRound(r: TraceTaskStats): RoundEntry {
  const rows: OmniMessage[] = [];
  for (let i = r.messageFrom; i <= r.messageTo; i++) {
    rows.push({
      timestamp: iso(r.taskIndex * 60_000 + (i - r.messageFrom) * 1000),
      type: "model_msg",
      payload: { type: "text", role: "assistant", text: `event ${i}` },
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
  analysis: TraceAnalysisResponse;
  expanded: number[];
  rounds?: RoundEntry[];
  shownRounds?: number;
}): string {
  return renderToStaticMarkup(
    createElement(TraceFileBody, {
      analysis: opts.analysis,
      currency: "USD",
      expanded: new Set(opts.expanded),
      rounds: new Map((opts.rounds ?? []).map((e) => [e.taskIndex, e])),
      shownRounds: opts.shownRounds ?? TRACE_ROUNDS_PAGE,
      error: null,
      highlight: null,
      pinnedRow: null,
      onHighlight: () => {},
      onToggle: () => {},
      onShowEarlier: () => {},
      onJump: () => {},
    }),
  );
}

const count = (html: string, re: RegExp): number => [...html.matchAll(re)].length;
const heads = (html: string): number => count(html, /data-slot="head"/g);
const earlierControls = (html: string): number => count(html, /data-slot="earlier"/g);
/** The rounds whose rows are on screen, by taskIndex (a row's key is `<taskIndex>-<i>`). */
const rowGroups = (html: string): number[] => [
  ...new Set([...html.matchAll(/data-trace-row="(\d+)-\d+"/g)].map((m) => Number(m[1]))),
];
const rows = (html: string): number => count(html, /data-trace-row="/g);

describe("a long Trace file", () => {
  const analysis = analysisOf(1200);
  const newest = analysis.tasks[1199]!;

  it("draws at most 50 round heads, and the rows of the one open round", () => {
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

  it("a collapsed round draws no rows, even with its events held from an earlier opening", () => {
    const html = render({ analysis, expanded: [], rounds: [readRound(newest)] });

    expect(rows(html)).toBe(0);
    expect(html).not.toContain('aria-expanded="true"');
  });

  it("an open round still being read draws a placeholder and no rows", () => {
    const html = render({ analysis, expanded: [1199] });

    expect(rows(html)).toBe(0);
    expect(html).toContain('role="status"');
    expect(html).toContain(S.traces.roundLoading);
  });

  it("an open round whose read failed says so in place of its rows", () => {
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

describe("the context ring", () => {
  const used = humanizeTokens(30_000 + 2_000 + 1_000);
  /** The first round's ring, read by its accessible name. */
  const ringOf = (html: string): string => {
    const start = html.indexOf(`aria-label="${S.chat.contextUsage} `);
    return start < 0 ? "" : html.slice(start, html.indexOf('"', start + 12));
  };

  it("is bounded by the file's context window", () => {
    const html = render({ analysis: analysisOf(3, { modelContextWindow: 200_000 }), expanded: [] });
    expect(ringOf(html)).toContain(`${used}/${humanizeTokens(200_000)}`);
  });

  it("falls back to 128k when the analysis carries no window", () => {
    const html = render({ analysis: analysisOf(3), expanded: [] });
    expect(ringOf(html)).toContain(`${used}/${humanizeTokens(128_000)}`);
  });
});
