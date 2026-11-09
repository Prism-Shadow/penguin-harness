// @vitest-environment jsdom
/**
 * The Trace panel while a machine's Trace file comes over before the panel reads it
 * (features/traces/trace-file-view.tsx).
 *
 * - Given the file made whole on this server and its analysis still on the way, the panel keeps
 *   the transfer row it showed: one loading state from the first byte to the analysis, never the
 *   skeleton again in between. Once the analysis is in, the file is drawn.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryProgress, TraceAnalysisResponse } from "@prismshadow/penguin-server/api";
import { TraceFileView } from "../src/features/traces/trace-file-view";
import { ThemeProvider } from "../src/state/theme";
import { mount, run, settle, unmountAll } from "./helpers/dom";
import { json, stubFetch } from "./helpers/fetch";
import { socketWorld } from "./helpers/api-socket-world";

vi.mock("../test/socket-stand-in", async (importActual) => {
  const actual = await importActual<typeof import("../src/api/socket")>();
  const { socketWorld } = await import("./helpers/api-socket-world");
  return { ...actual, apiSocket: socketWorld.apiSocket };
});

const FILL = "/history?fill=only&file=1&agent=a";

/** A file with no rounds yet: what is drawn once the analysis is in. */
const ANALYSIS: TraceAnalysisResponse = {
  elapsedMs: 0,
  apiMs: 0,
  toolMs: 0,
  requests: [],
  tasks: [],
  toolCalls: [],
  modelSegments: [],
  toolSpans: [],
  otherSpans: [],
  reconnectCount: 0,
  compactionCount: 0,
  usageTrend: [],
};

/** How far the file has come over, as the hub reports it. */
const progress = (done: number): HistoryProgress => ({
  phase: "fill",
  machineId: null,
  doneBytes: done,
  totalBytes: 400_000,
  doneLines: 0,
  totalLines: 0,
  waiting: null,
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // jsdom has no `matchMedia`; the theme asks it for the system's light or dark.
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});
afterEach(async () => {
  await unmountAll();
  socketWorld.reset();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a machine's Trace file coming over", () => {
  it("keeps the transfer row from the first byte until the analysis is in", async () => {
    let answer: (response: Response) => void = () => {};
    stubFetch((req) =>
      req.path.endsWith("/analysis")
        ? new Promise<Response>((resolve) => {
            answer = resolve;
          })
        : json({ events: [], offset: 0, limit: 0, total: 0 }),
    );
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
    const row = () => document.querySelector("[data-transfer]");
    await run(() => socketWorld.emit(FILL, "progress", progress(100_000)));
    await run(() => vi.advanceTimersByTime(1_000));
    expect(row()).not.toBeNull();

    await run(() => socketWorld.emit(FILL, "progress", progress(400_000)));
    await run(() => socketWorld.emit(FILL, "filled", {}));
    // Filled, the analysis asked for and not in yet: still the same loading state.
    expect(row()).not.toBeNull();

    await run(() => answer(json(ANALYSIS)));
    await settle();
    expect(row()).toBeNull();
  });
});
