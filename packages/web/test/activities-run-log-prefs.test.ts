/**
 * The run log's remembered "Show reasoning" switch, the hidden-reasoning stream, and when a
 * tool output is long enough to offer "Show all".
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SHOW_REASONING_KEY,
  readShowReasoning,
  writeShowReasoning,
} from "../src/features/activities/run-log-prefs";
import { MessageItems, visibleStreamItems } from "../src/features/chat/message-stream";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import { outputExpandable } from "../src/features/chat/disclosure-row";
import { ToolOutputActions } from "../src/features/chat/tool-call-card";
import type { ChatItem } from "../src/lib/omni/stream-model";
import { S } from "../src/lib/strings";

function memory() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("run log prefs", () => {
  it("shows reasoning until it is switched off, and remembers the switch", () => {
    const storage = memory();
    expect(readShowReasoning(storage)).toBe(true);
    writeShowReasoning(false, storage);
    expect(storage.values.get(SHOW_REASONING_KEY)).toBe("hidden");
    expect(readShowReasoning(storage)).toBe(false);
    writeShowReasoning(true, storage);
    expect(readShowReasoning(storage)).toBe(true);
  });

  it("shows reasoning when storage is unreadable, and a failed write does not throw", () => {
    expect(readShowReasoning(throwing)).toBe(true);
    expect(() => writeShowReasoning(false, throwing)).not.toThrow();
    const storage = memory();
    storage.values.set(SHOW_REASONING_KEY, "nonsense");
    expect(readShowReasoning(storage)).toBe(true);
  });
});

const thinking = (id: number, text: string): ChatItem => ({
  kind: "thinking",
  id,
  thinking: text,
  streaming: false,
});
const reply = (id: number, text: string): ChatItem => ({
  kind: "assistant_text",
  id,
  text,
  streaming: false,
});

function ctx(overrides: Partial<StreamRenderContext>): StreamRenderContext {
  return {
    pendingApprovals: new Map(),
    onApprove: async () => {},
    origin: [],
    taskRunning: false,
    ...overrides,
  };
}

describe("hidden reasoning", () => {
  const items = [thinking(1, "first idea"), reply(2, "Done."), thinking(3, "second idea")];

  it("keeps every item while reasoning is shown", () => {
    expect(visibleStreamItems(items, ctx({}))).toBe(items);
  });

  it("drops reasoning, keeping only the latest while the Task still runs", () => {
    expect(visibleStreamItems(items, ctx({ hideReasoning: true })).map((i) => i.id)).toEqual([2]);
    expect(
      visibleStreamItems(items, ctx({ hideReasoning: true, taskRunning: true })).map((i) => i.id),
    ).toEqual([2, 3]);
    // Reasoning that is not the latest item is dropped even while running.
    expect(
      visibleStreamItems(items.slice(0, 2), ctx({ hideReasoning: true, taskRunning: true })).map(
        (i) => i.id,
      ),
    ).toEqual([2]);
  });

  it("renders no thinking block, and says the agent is thinking while it runs", () => {
    const render = (c: StreamRenderContext) =>
      renderToStaticMarkup(createElement(MessageItems, { items, ctx: c }));
    const shown = render(ctx({ taskRunning: true }));
    expect(shown).toContain(S.chat.thinking);
    expect(shown).not.toContain("data-thinking-hidden");

    const hiddenRunning = render(ctx({ hideReasoning: true, taskRunning: true }));
    expect(hiddenRunning).toContain(S.chat.thinkingHidden);
    expect(hiddenRunning.match(/data-thinking-hidden/g)).toHaveLength(1);
    expect(hiddenRunning).not.toContain(`>${S.chat.thinking}<`);

    const hiddenDone = render(ctx({ hideReasoning: true }));
    expect(hiddenDone).not.toContain(S.chat.thinkingHidden);
    expect(hiddenDone).not.toContain(`>${S.chat.thinking}<`);
    expect(hiddenDone).toContain("Done.");
  });
});

describe("tool output length", () => {
  it("offers Show all past eight lines", () => {
    const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
    expect(outputExpandable(lines(3))).toBe(false);
    expect(outputExpandable(lines(8))).toBe(false);
    expect(outputExpandable(lines(9))).toBe(true);
    expect(outputExpandable(lines(20))).toBe(true);
  });

  it("counts lines as Loom does: a final newline and CRLF endings add none", () => {
    const lines = (n: number, end: string) =>
      Array.from({ length: n }, (_, i) => `line ${i + 1}${end}`).join("");
    expect(outputExpandable(lines(8, "\n"))).toBe(false);
    expect(outputExpandable(lines(8, "\r\n"))).toBe(false);
    expect(outputExpandable(lines(8, "\r"))).toBe(false);
    expect(outputExpandable(lines(9, "\r\n"))).toBe(true);
  });
});

describe("tool output actions", () => {
  const long = Array.from({ length: 20 }, (_, i) => `row ${i + 1}`).join("\n");
  const render = (toolOutputActions: boolean | undefined, output = long, full = false) =>
    renderToStaticMarkup(
      createElement(ToolOutputActions, {
        output,
        ctx: { toolOutputActions },
        full,
        onToggleFull: () => {},
      }),
    );

  it("gives Chat's tool cards neither control", () => {
    expect(render(undefined)).toBe("");
    expect(render(false)).toBe("");
  });

  it("gives a run log Copy, and Show all only for a long output", () => {
    const longActions = render(true);
    expect(longActions).toContain(S.chat.copyToolOutput);
    expect(longActions).toContain(S.chat.showAllOutput);
    expect(longActions).toContain('aria-expanded="false"');
    expect(render(true, long, true)).toContain(S.chat.showLessOutput);
    const shortActions = render(true, "a\nb\nc");
    expect(shortActions).toContain(S.chat.copyToolOutput);
    expect(shortActions).not.toContain(S.chat.showAllOutput);
    expect(render(true, "")).toBe("");
  });
});
