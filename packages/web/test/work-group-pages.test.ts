// @vitest-environment jsdom
import { createElement as h } from "react";
import { toolCall } from "@prismshadow/amsp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "../src/state/theme";
import { SessionWorkGroup } from "../src/features/chat/work-group";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import { FindRevealContext } from "../src/lib/find-expand";
import { approvalKey, type ChatItem, type ToolCallItem } from "../src/lib/amsp/stream-model";
import { S } from "../src/lib/strings";
import { memoryStorage, stubLocalStorage } from "./helpers/storage";
import { button, click, hasButton, mount, unmountAll } from "./helpers/dom";

const context: StreamRenderContext = {
  origin: [],
  pendingApprovals: new Map(),
  onApprove: async () => {},
  taskRunning: true,
};
const think = (id: number, thinking: string): ChatItem => ({
  kind: "thinking",
  id,
  thinking,
  streaming: false,
});
const call = (id: number): ToolCallItem => ({
  kind: "tool_call",
  id,
  toolCallId: `step-${id}`,
  name: "exec_command",
  argumentsText: JSON.stringify({ cmd: `echo ${id}`, description: `Details for command ${id}` }),
  callStreaming: false,
  callComplete: true,
  output: `Output ${id}`,
  outputStreaming: false,
  outputComplete: true,
});
const group = (items: ChatItem[], ctx = context, find = false) =>
  h(
    ThemeProvider,
    null,
    h(
      FindRevealContext.Provider,
      { value: find },
      h(SessionWorkGroup, { items, ctx, isLast: true }),
    ),
  );
const position = () => document.querySelector("[data-step-navigation]")?.getAttribute("aria-label");

beforeEach(() => {
  stubLocalStorage(memoryStorage());
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(unmountAll);
const header = () => document.querySelector<HTMLButtonElement>("button[data-group-header]")!;
const rows = () => Array.from(document.querySelectorAll(".ui-tree > [data-depth]"));
const stepToggle = () => rows()[0]!.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
function mode(value: "compact" | "expanded" | "standard", theme = "modern") {
  stubLocalStorage(
    memoryStorage({ "penguin.activityDisplayMode": value, "penguin.themeId": theme }),
  );
}

describe("work display modes", () => {
  it("defaults to running groups with all step labels and closed details", async () => {
    const view = await mount(group([think(1, "First decision"), call(2)]));
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toHaveLength(2);
    expect(position()).toBeUndefined();
    expect(view.container.textContent).not.toContain("First decision");
    expect(view.container.textContent).not.toContain("Output 2");
    expect(view.container.textContent).not.toContain("Details for command 2");
    await click(stepToggle());
    expect(view.container.textContent).toContain("First decision");
    await view.rerender(
      group([think(1, "First decision"), call(2)], { ...context, taskRunning: false }),
    );
    expect(header().getAttribute("aria-expanded")).toBe("false");
  });

  it("expands existing work and keeps a manually folded step closed as other output arrives", async () => {
    mode("expanded", "github");
    const first = think(1, "First decision");
    const tool = call(2);
    const view = await mount(group([first, tool], { ...context, taskRunning: false }));
    expect(view.container.textContent).toContain("First decision");
    expect(view.container.textContent).toContain("Output 2");
    await click(stepToggle());
    tool.output = "New output";
    await view.rerender(group([first, tool, think(3, "Next decision")]));
    expect(view.container.textContent).not.toContain("First decision");
    expect(view.container.textContent).toContain("New output");
    expect(view.container.textContent).toContain("Next decision");
  });

  it.each(["modern", "github", "geek", "doodle"])(
    "keeps a compact step collapsed while paging in %s",
    async (theme) => {
      mode("compact", theme);
      const first = think(1, "First decision");
      const view = await mount(group([first, call(2)]));
      expect(position()).toBe(S.chat.workStepPosition(2));
      expect(rows()).toHaveLength(0);
      await click(button(S.chat.previousWorkStep));
      expect(rows()).toHaveLength(0);
      await click(header());
      expect(rows()).toHaveLength(2);
      expect(view.container.textContent).not.toContain("First decision");
      await click(stepToggle());
      expect(view.container.textContent).toContain("First decision");
      await view.rerender(group([first, call(2), think(3, "Later decision")]));
      expect(position()).toBe(S.chat.workStepPosition(1));
      await click(button(S.chat.nextWorkStep));
      expect(rows()).toHaveLength(3);
      expect(view.container.textContent).toContain("First decision");
      expect(view.container.textContent).not.toContain("Output 2");
      await click(button(S.chat.previousWorkStep));
      expect(view.container.textContent).toContain("First decision");
      await click(button(S.chat.latestWorkStep));
      await view.rerender(group([first, call(2), think(3, "Later decision"), call(4)]));
      expect(position()).toBe(S.chat.workStepPosition(4));
    },
  );

  it("updates the current page in place, reveals all loaded text for find and restores both folds", async () => {
    mode("compact");
    const first = think(1, "First decision"),
      tool = call(2);
    const view = await mount(group([first, tool]));
    tool.output = "Updated output";
    await view.rerender(group([first, tool]));
    expect(position()).toBe(S.chat.workStepPosition(2));
    await click(button(S.chat.previousWorkStep));
    await view.rerender(group([first, tool, think(3, "More work")], context, true));
    expect(position()).toBeUndefined();
    for (const phrase of ["First decision", "Updated output", "More work"])
      expect(view.container.textContent).toContain(phrase);
    await view.rerender(group([first, tool, think(3, "More work")]));
    expect(rows()).toHaveLength(0);
    expect(position()).toBe(S.chat.workStepPosition(1));
    await click(header());
    expect(stepToggle().getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["done", "failed", "stopped"] as const)(
    "appends one %s outcome, preserves a reader and can reopen a saved run",
    async (state) => {
      mode("compact");
      const first = think(1, "First decision"),
        second = call(2);
      const view = await mount(group([first, second]));
      await click(button(S.chat.previousWorkStep));
      await view.rerender(group([first, second], { ...context, taskRunning: false }));
      expect(position()).toBe(S.chat.workStepPosition(1));
      second.workOutcome = { state, durationMs: 2300 };
      const finished = () => group([first, second], { ...context, taskRunning: false });
      await view.rerender(finished());
      expect(position()).toBe(S.chat.workStepPosition(1));
      expect(rows()).toHaveLength(0);
      await click(button(S.chat.latestWorkStep));
      const headline = () => document.querySelector("[data-step-terminal]");
      expect(headline()).not.toBeNull();
      expect(headline()?.getAttribute("data-state")).toBe(state === "failed" ? "error" : "done");
      expect(rows()).toHaveLength(0);
      const elapsed = headline()?.querySelector("[data-step-elapsed]")?.textContent;
      expect(elapsed).toContain("2.3s");
      await click(header());
      expect(rows()).toHaveLength(2);
      await click(stepToggle());
      await click(button(S.chat.previousWorkStep));
      expect(rows()).toHaveLength(2);
      expect(view.container.textContent).toContain("First decision");
      expect(document.querySelector("[data-step-elapsed]")?.textContent).toBe(elapsed);
      await click(button(S.chat.latestWorkStep));
      const endLabel = headline()?.textContent;
      await unmountAll();
      await mount(finished());
      expect(position()).toBe(S.chat.workStepPosition(3));
      expect(headline()?.textContent).toBe(endLabel);
      await click(button(S.chat.previousWorkStep));
      expect(header().getAttribute("aria-expanded")).toBe("false");
      expect(rows()).toHaveLength(0);
    },
  );

  it.each(["read_file", "edit_file", "write_file"])(
    "summarizes the description and path of a streaming %s on its own page",
    async (name) => {
      mode("compact");
      const item = call(10);
      const path = "资料/会议/每周 计划/项目  记录.md";
      item.name = name;
      item.argumentsText = '{"description":"核对会议记录","file_path":"资';
      item.callStreaming = true;
      const view = await mount(group([item]));
      expect(header().textContent).toContain("核对会议记录");
      expect(header().textContent).not.toContain("资");
      item.argumentsText = JSON.stringify({ description: "核对会议记录", file_path: path });
      await view.rerender(group([item]));
      expect(header().textContent).toContain("…/每周 计划/项目  记录.md");
      expect(
        header().querySelector('[data-tooltip-content="code"]')?.getAttribute("data-tooltip"),
      ).toBe(path);
      item.argumentsText = JSON.stringify({ description: path, file_path: path });
      await view.rerender(group([item]));
      expect(header().querySelectorAll('[data-slot="detail"]')).toHaveLength(1);
      expect(rows()).toHaveLength(0);
    },
  );

  it("cycles through outstanding parallel approvals and an active retry without duplicating any action", async () => {
    mode("compact");
    const calls = [call(1), call(2)];
    const pendingApprovals = new Map(
      calls.map((item) => [
        approvalKey([], item.toolCallId),
        {
          toolCall: toolCall({
            toolCallId: item.toolCallId,
            name: item.name,
            arguments: item.argumentsText,
          }),
        },
      ]),
    );
    const onApprove = vi.fn(async () => {});
    const onRetryNow = vi.fn();
    const ctx = { ...context, pendingApprovals, onApprove, onRetryNow, onGiveUp: vi.fn() };
    const items: ChatItem[] = [
      ...calls,
      {
        kind: "reconnect",
        id: 3,
        status: "retryable",
        attempt: 1,
        retrying: false,
        plannedDelayMs: 30_000,
        arrivedAtMs: Date.now(),
      },
      think(4, "Another tool is preparing"),
    ];
    const view = await mount(group(items, ctx));
    expect(rows()).toHaveLength(0);
    expect(hasButton(S.chat.approve)).toBe(false);
    for (let i = 0; i < calls.length; i++) {
      await click(button(S.chat.waitingWorkStep));
      expect(position()).toBe(S.chat.workStepPosition(i + 1));
      const item = calls[i]!;
      await click(button(S.chat.approve));
      expect(onApprove).toHaveBeenLastCalledWith(item.toolCallId, "allow", []);
      pendingApprovals.delete(approvalKey([], item.toolCallId));
      await view.rerender(group(items, ctx));
    }
    await click(button(S.chat.waitingWorkStep));
    expect(position()).toBe(S.chat.workStepPosition(3));
    await click(button(S.chat.requestRetry.retryNow));
    expect(onRetryNow).toHaveBeenCalledOnce();
  });
});
