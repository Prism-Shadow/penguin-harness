// @vitest-environment jsdom
/**
 * The round navigator in use (features/traces/trace-round-nav.tsx inside trace-file-view.tsx), on
 * the real Trace view against a fake of the Trace endpoints. A 60-round file, so the view draws
 * the newest 50 cards and the early rounds are reachable only through the navigator.
 *
 * - A navigator row for a round whose card is not drawn draws it, opens it and moves focus to its
 *   head; the row is then the list's current one.
 * - A round's "back" control opens the navigator, folded or not, and moves focus to that round's
 *   row, marked current.
 * - ArrowDown moves focus to the next row and ArrowUp back; the list keeps one tab stop.
 * - A round number and Enter in the box jump to that round; a number past the last round does
 *   nothing.
 */
import { act, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OmniMessage } from "@prismshadow/penguin-core/omnimessage";
import type { TraceAnalysisResponse, TraceTaskStats } from "@prismshadow/penguin-server/api";
import { TraceFileView } from "../src/features/traces/trace-file-view";
import { S } from "../src/lib/strings";
import { ThemeProvider } from "../src/state/theme";
import { click, field, mount, type, unmountAll, waitFor } from "./helpers/dom";
import { json, stubFetch } from "./helpers/fetch";

const ROUNDS = 60;
/** Events per round: the prompt and the reply. */
const PER_ROUND = 2;
const iso = (ms: number): string => new Date(Date.UTC(2026, 9, 22) + ms).toISOString();

function round(k: number): TraceTaskStats {
  return {
    taskIndex: k,
    messageFrom: k * PER_ROUND,
    messageTo: (k + 1) * PER_ROUND - 1,
    startTs: iso(k * 60_000),
    endTs: iso(k * 60_000 + 5_000),
    tokens: { cacheRead: 900, cacheWrite: 100, output: 50 },
    llmMs: 4_000,
    toolMs: 0,
    prompt: `Question ${k + 1}`,
  };
}

const ANALYSIS: TraceAnalysisResponse = {
  elapsedMs: ROUNDS * 5_000,
  apiMs: ROUNDS * 4_000,
  toolMs: 0,
  requests: [],
  tasks: Array.from({ length: ROUNDS }, (_, k) => round(k)),
  toolCalls: [],
  modelSegments: [],
  toolSpans: [],
  otherSpans: [],
  reconnectCount: 0,
  compactionCount: 0,
  usageTrend: [],
};

function event(i: number): OmniMessage {
  const k = Math.floor(i / PER_ROUND);
  return i % PER_ROUND === 0
    ? {
        timestamp: iso(k * 60_000),
        type: "model_msg",
        payload: { type: "text", role: "user", text: `Question ${k + 1}` },
      }
    : {
        timestamp: iso(k * 60_000 + 5_000),
        type: "model_msg",
        payload: { type: "text", role: "assistant", text: "Done." },
      };
}

const navRow = (k: number): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`[data-nav-round="${k}"] button`);
const card = (k: number): Element | null => document.querySelector(`[data-round="${k}"]`);
const toggleOf = (k: number): HTMLElement | null =>
  card(k)?.querySelector<HTMLElement>('[data-slot="toggle"]') ?? null;

/** A key press on `target`, by default what holds focus. */
async function press(key: string, target: Element | null = document.activeElement): Promise<void> {
  if (target === null) throw new Error("nothing has focus");
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

describe("the round navigator", () => {
  beforeEach(async () => {
    // jsdom has no `matchMedia`; the theme asks it for the system's light or dark.
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    stubFetch((req) => {
      if (req.path.endsWith("/analysis")) return json(ANALYSIS);
      const offset = Number(req.query.get("offset"));
      const limit = Number(req.query.get("limit"));
      const total = ROUNDS * PER_ROUND;
      const events = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, j) =>
        event(offset + j),
      );
      return json({ events, offset, limit, total });
    });
    await mount(
      h(
        ThemeProvider,
        null,
        h(TraceFileView, {
          projectId: "p",
          agentId: "a",
          sessionId: "s",
          index: 1,
          reloadSignal: 0,
          highlight: null,
          onHighlight: () => {},
        }),
      ),
    );
    await waitFor(() => navRow(0) !== null);
  });
  afterEach(() => unmountAll());

  it("a row for a round not drawn draws its card, opens it and focuses its head", async () => {
    expect(card(2)).toBeNull();

    await click(navRow(2)!);

    expect(toggleOf(2)?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggleOf(2));
    expect(navRow(2)?.getAttribute("aria-current")).toBe("true");
  });

  it("a round's back control opens the folded navigator and focuses that round's row", async () => {
    await click(navRow(2)!);
    await click(document.querySelector('[data-slot="nav-toggle"]')!);
    expect(navRow(2)).toBeNull();

    const back = card(2)!.querySelector(`[aria-label="${S.traces.backToNav}"]`)!;
    await click(back);

    expect(document.activeElement).toBe(navRow(2));
    expect(navRow(2)?.getAttribute("aria-current")).toBe("true");
  });

  it("the arrow keys walk the rows, and the list keeps one tab stop", async () => {
    await click(navRow(2)!);
    await click(card(2)!.querySelector(`[aria-label="${S.traces.backToNav}"]`)!);

    await press("ArrowDown");
    expect(document.activeElement).toBe(navRow(3));
    await press("ArrowUp");
    await press("ArrowUp");
    expect(document.activeElement).toBe(navRow(1));
    const stops = [...document.querySelectorAll("[data-nav-round] button")].filter(
      (b) => b.getAttribute("tabindex") === "0",
    );
    expect(stops).toEqual([navRow(1)]);
  });

  it("a round number and Enter jump to it; a number past the last round does nothing", async () => {
    const box = field(S.traces.jumpToRound) as HTMLInputElement;
    const drawn = () => document.querySelectorAll("[data-round]").length;
    const before = drawn();

    await type(box, "999");
    await press("Enter", box);
    expect(drawn()).toBe(before);
    expect(document.activeElement?.getAttribute("data-slot")).not.toBe("toggle");

    await type(box, "3");
    await press("Enter", box);
    expect(document.activeElement).toBe(toggleOf(2));
    expect(box.value).toBe("");
  });
});
