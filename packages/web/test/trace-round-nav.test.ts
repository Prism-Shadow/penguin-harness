// @vitest-environment jsdom
/**
 * The round navigator in use (features/traces/trace-round-nav.tsx, on the toolbar's dropdown in
 * trace-picker.tsx), on the real Trace view against a fake of the Trace endpoints, inside the
 * panel's scroll box. A 60-round file, so the view draws the newest 50 rounds and the early ones
 * are reachable only through the navigator.
 *
 * - The rounds button names the round in view; opening it lists every round, that round current
 *   and focused.
 * - A row for a round not drawn closes the list, draws and opens the round, focuses its head, and
 *   the button names it.
 * - Escape closes the list and hands focus back to the button.
 * - ArrowDown and ArrowUp walk the rows; Home and End jump to the first and the last.
 * - A round number and Enter in the box jump to that round; a number past the last round does
 *   nothing.
 * - No row names a thinking level, not even where the round switched it.
 * - As the panel scrolls, the button follows the first round fully under the toolbar; scrolled
 *   to the end, it names the last round drawn.
 */
import { act, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AmspRecord } from "@prismshadow/amsp";
import type { TraceAnalysisResponse, TraceTaskStats } from "@prismshadow/penguin-server/api";
import { TraceFileView } from "../src/features/traces/trace-file-view";
import { S } from "../src/lib/strings";
import { ThemeProvider } from "../src/state/theme";
import { click, field, mount, pressEscape, type, unmountAll, waitFor } from "./helpers/dom";
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
  // The level is stated in round 1 and switched in round 2.
  requests: [
    { beginTs: iso(0), taskIndex: 0, thinkingLevel: "medium" },
    { beginTs: iso(60_000), taskIndex: 1, thinkingLevel: "high" },
    { beginTs: iso(120_000), taskIndex: 2, thinkingLevel: "high" },
  ],
  tasks: Array.from({ length: ROUNDS }, (_, k) => round(k)),
  toolCalls: [],
  modelSegments: [],
  toolSpans: [],
  otherSpans: [],
  reconnectCount: 0,
  compactionCount: 0,
  usageTrend: [],
};

function event(i: number): AmspRecord {
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

const navButton = (): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>('[data-slot="nav-button"]')!;
const navRow = (k: number): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`[data-pick-row="${k}"] button`);
const roundRow = (k: number): HTMLElement | null =>
  document.querySelector<HTMLElement>(`[data-round="${k}"]`);
const toggleOf = (k: number): HTMLElement | null =>
  roundRow(k)?.querySelector<HTMLElement>('[data-slot="toggle"]') ?? null;

/** A key press on `target`, by default what holds focus. */
async function press(key: string, target: Element | null = document.activeElement): Promise<void> {
  if (target === null) throw new Error("nothing has focus");
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

/** Lets a frame pass: what the list's focus and the scroll measurement wait for. */
async function nextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
}

async function openList(): Promise<void> {
  await click(navButton());
  await nextFrame();
}

/** Places an element at a viewport `top` with a `height`, as layout would. */
function place(el: Element, top: number, height: number): void {
  el.getBoundingClientRect = () => ({
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 400,
    width: 400,
    x: 0,
    y: top,
    toJSON: () => ({}),
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
        h(
          "div",
          { "data-scroll-box": "" },
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
      ),
    );
    await waitFor(() => document.querySelector('[data-slot="nav-button"]') !== null);
  });
  afterEach(() => unmountAll());

  it("names the round in view, and opens on every round with that one current and focused", async () => {
    expect(navButton().textContent).toContain(S.traces.task(60));
    expect(navRow(0)).toBeNull();

    await openList();

    expect(document.querySelectorAll("[data-pick-row]")).toHaveLength(ROUNDS);
    expect(navButton().getAttribute("aria-expanded")).toBe("true");
    expect(navRow(59)?.getAttribute("aria-current")).toBe("true");
    expect(document.activeElement).toBe(navRow(59));
  });

  it("a row for a round not drawn closes the list, draws and opens the round, and focuses its head", async () => {
    expect(roundRow(2)).toBeNull();
    await openList();

    await click(navRow(2)!);

    expect(navRow(2)).toBeNull();
    expect(toggleOf(2)?.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggleOf(2));
    expect(navButton().textContent).toContain(S.traces.task(3));
  });

  it("Escape closes the list and hands focus back to the button", async () => {
    await openList();

    await pressEscape();

    expect(navRow(59)).toBeNull();
    expect(document.activeElement).toBe(navButton());
  });

  it("the arrow keys walk the rows, and Home and End jump to the ends", async () => {
    await openList();

    await press("ArrowUp");
    expect(document.activeElement).toBe(navRow(58));
    await press("ArrowDown");
    expect(document.activeElement).toBe(navRow(59));
    await press("Home");
    expect(document.activeElement).toBe(navRow(0));
    await press("End");
    expect(document.activeElement).toBe(navRow(59));
  });

  it("a round number and Enter jump to it; a number past the last round does nothing", async () => {
    await openList();
    const box = field(S.traces.jumpToRound) as HTMLInputElement;
    const drawn = () => document.querySelectorAll("[data-round]").length;
    const before = drawn();

    await type(box, "999");
    await press("Enter", box);
    expect(drawn()).toBe(before);
    expect(navRow(0)).not.toBeNull();

    await type(box, "3");
    await press("Enter", box);
    expect(navRow(0)).toBeNull();
    expect(document.activeElement).toBe(toggleOf(2));
  });

  it("no row names a thinking level, not even where the round switched it", async () => {
    await openList();
    const names = Object.values(S.chat.thinkingLevelNames);

    for (const k of [0, 1, 2]) {
      const text = navRow(k)?.textContent ?? "";
      expect(text).not.toContain("→");
      for (const name of names) expect(text).not.toContain(name);
    }
  });

  /**
   * Lays the drawn rounds out as collapsed 30px rows under a toolbar ending at 40 — round 19
   * mostly behind it, round 20 the first wholly under it — in an 800px box scrolled to `scrollTop`.
   */
  async function scrollTo(scrollTop: number): Promise<void> {
    place(document.querySelector('[data-slot="toolbar"]')!, 0, 40);
    for (let k = 10; k < ROUNDS; k++) {
      const top = 44 + (k - 20) * 30;
      place(roundRow(k)!, top, 30);
      place(roundRow(k)!.querySelector('[data-slot="head"]')!, top, 30);
    }
    const box = document.querySelector<HTMLElement>("[data-scroll-box]")!;
    place(box, 0, 800);
    Object.defineProperty(box, "scrollHeight", { configurable: true, value: 3000 });
    Object.defineProperty(box, "clientHeight", { configurable: true, value: 800 });
    Object.defineProperty(box, "scrollTop", { configurable: true, value: scrollTop });
    await act(async () => {
      box.dispatchEvent(new Event("scroll"));
    });
    await nextFrame();
  }

  it("as the panel scrolls, the button follows the first round fully under the toolbar", async () => {
    await scrollTo(1000);
    expect(navButton().textContent).toContain(S.traces.task(21));
  });

  it("scrolled to the end, the button names the last round drawn", async () => {
    await scrollTo(1000);
    // The same heads, the box now at its end: the last rounds can climb no further.
    await scrollTo(2200);
    expect(navButton().textContent).toContain(S.traces.task(60));
  });
});
