// @vitest-environment jsdom
/**
 * A tool call whose output came folded in a history window, unfolded by the reader
 * (features/chat/tool-call-card.tsx and elided-body.tsx, over the stream controller's
 * loadBodies and the trace-body stream).
 *
 * - Given the call closed, it is drawn and nothing is fetched: a folded value costs nothing until
 *   someone opens it.
 * - When the reader opens it, the preview shows its head and tail around an ellipsis, the whole
 *   output is asked for by its ref, and once it has arrived the card shows it in place of the
 *   preview.
 */
import { createElement as h, useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assistantText, toolCall, toolCallOutput, userText } from "@prismshadow/amsp";
import type { AmspRecord } from "@prismshadow/amsp";
import type { HistoryMessage } from "@prismshadow/penguin-server/api";
import { ElidedBodiesContext } from "../src/features/chat/elided-body";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import { SessionToolCall } from "../src/features/chat/tool-call-card";
import { createStreamController } from "../src/lib/amsp/stream-controller";
import type { StreamController } from "../src/lib/amsp/stream-controller";
import { findToolCard } from "../src/lib/amsp/stream-model";
import { ThemeProvider } from "../src/state/theme";
import { click, mount, run, unmountAll } from "./helpers/dom";
import { FakeHistoryStream } from "./helpers/history-stream";

beforeEach(() => {
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
  vi.unstubAllGlobals();
});

const at = <M extends AmspRecord>(msg: M, ts: string): M => ({ ...msg, timestamp: ts });

const WHOLE = Array.from({ length: 400 }, (_, i) => `row ${i}: ${"x".repeat(60)}`).join("\n");
const HEAD = "row 0";
const TAIL = "row 399";

const CTX: StreamRenderContext = {
  pendingApprovals: new Map(),
  onApprove: async () => {},
  origin: [],
  taskRunning: false,
};

/** A controller whose window holds one call with its output folded, and the page drawing it. */
async function openWindow(): Promise<{ stream: FakeHistoryStream; container: HTMLElement }> {
  const stream = new FakeHistoryStream();
  const listeners = new Set<() => void>();
  const controller: StreamController = createStreamController({
    sessionId: "s1",
    openHistory: stream.open,
    openBody: stream.openBody,
    onTaskState: () => {},
    onLoading: () => {},
    onError: () => {},
    onModelChange: () => listeners.forEach((listener) => listener()),
    onPendingChange: () => {},
  });
  const loaded = controller.load();
  controller.handleServer({ type: "task_state", state: "idle" });
  const output = at(
    toolCallOutput({ output: `${HEAD}${TAIL}`, toolCallId: "c1", status: "completed" }),
    "2026-07-05T00:00:02.000Z",
  );
  const messages: HistoryMessage[] = [
    at(userText("show me the log"), "2026-07-05T00:00:00.000Z"),
    at(
      toolCall({ name: "exec_command", arguments: '{"cmd":"cat big.log"}', toolCallId: "c1" }),
      "2026-07-05T00:00:01.000Z",
    ),
    {
      ...output,
      elided: [
        { path: "payload.output", bytes: WHOLE.length, lines: 400, head: HEAD.length, ref: "r-1" },
      ],
    },
    at(assistantText("done"), "2026-07-05T00:00:03.000Z"),
  ];
  stream.window(stream.reads[0]!, { messages });
  await loaded;

  function Page() {
    const [, setTick] = useState(0);
    useEffect(() => {
      const listener = () => setTick((t) => t + 1);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }, []);
    const card = findToolCard(controller.model, [], "c1")!;
    return h(
      ThemeProvider,
      null,
      h(
        ElidedBodiesContext.Provider,
        { value: { load: controller.loadBodies } },
        h(SessionToolCall, { item: card, ctx: CTX }),
      ),
    );
  }
  const { container } = await mount(h(Page));
  return { stream, container };
}

describe("unfolding a folded tool output", () => {
  it("fetches nothing while the call stays closed", async () => {
    const { stream, container } = await openWindow();
    expect(container.querySelector('button[aria-expanded="false"]')).not.toBeNull();
    expect(container.textContent).not.toContain(TAIL);
    expect(stream.bodies).toHaveLength(0);
  });

  it("shows the preview, asks for the whole by its ref, and shows the whole once it has arrived", async () => {
    const { stream, container } = await openWindow();
    await click(container.querySelector('button[aria-expanded="false"]')!);
    expect(container.textContent).toContain(`${HEAD}\n…\n${TAIL}`);
    expect(stream.bodies.map((b) => b.ref)).toEqual(["r-1"]);
    const body = stream.bodies[0]!.handlers;
    await run(() => {
      body.onRecords?.({ windowId: "b", offset: 0, text: WHOLE.slice(0, 5_000) }, "part");
      body.onRecords?.({ windowId: "b", offset: 5_000, text: WHOLE.slice(5_000) }, "part");
      body.onDone?.(null);
    });
    expect(container.textContent).toContain(WHOLE);
    expect(container.textContent).not.toContain(`${HEAD}\n…`);
  });
});
