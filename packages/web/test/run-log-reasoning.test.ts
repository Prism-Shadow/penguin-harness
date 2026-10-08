/**
 * A stage run's log folds blank reasoning into the step it led to; Chat keeps every reasoning
 * row (react-dom/server static markup, node env, no DOM).
 */
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MessageItems, type StreamRenderContext } from "../src/features/chat/message-stream";
import type { ChatItem } from "../src/lib/omni/stream-model";
import { S } from "../src/lib/strings";

// Tool cards read the user's tool aliases from the theme; none are set here.
vi.mock("../src/state/theme", () => ({ useTheme: () => ({ toolAliases: {} }) }));

const ITEMS = [
  { kind: "thinking", id: 1, thinking: "  ", streaming: false, durationMs: 49 },
  {
    kind: "tool_call",
    id: 2,
    toolCallId: "call-1",
    name: "read",
    argumentsText: '{"path":"module-result.json"}',
    callStreaming: false,
    callComplete: true,
    output: "{}",
    outputStreaming: false,
    outputComplete: true,
    durationMs: 71,
  },
] as ChatItem[];

function render(extra: Partial<StreamRenderContext>) {
  const ctx: StreamRenderContext = {
    pendingApprovals: new Map(),
    onApprove: async () => {},
    origin: [],
    // A running last group starts open, so its rows render.
    taskRunning: true,
    ...extra,
  };
  return renderToStaticMarkup(createElement(MessageItems, { items: ITEMS, ctx }));
}

describe("run log reasoning", () => {
  it("folds blank reasoning into the next step as its time", () => {
    const html = render({ runLog: true });
    expect(html).toContain(S.chat.thoughtFor("49ms"));
    expect(html).not.toContain(`>${S.chat.thinking}<`);
  });

  it("leaves Chat's reasoning rows as they were", () => {
    const html = render({});
    expect(html).toContain(S.chat.thinking);
    expect(html).not.toContain(S.chat.thoughtFor("49ms"));
  });
});
