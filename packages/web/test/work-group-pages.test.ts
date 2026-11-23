// @vitest-environment jsdom
/** The public Session stream drives all three display modes, including live updates and history. */
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
/** The pending approvals of these calls, as the session's approval map holds them. */
const waitingOn = (calls: ToolCallItem[]) =>
  new Map(
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
const count = () => header().querySelector("[data-step-count]")?.textContent;
/** What a sighted reader sees of an element: its text without the visually hidden words. */
function shownText(element: Element): string {
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll(".sr-only")) hidden.remove();
  return copy.textContent ?? "";
}

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
function mode(value: "compact" | "expanded" | "standard") {
  stubLocalStorage(memoryStorage({ "penguin.activityDisplayMode": value }));
}

describe("work display modes", () => {
  it("defaults to running groups whose closed tool rows keep their description", async () => {
    const view = await mount(group([think(1, "First decision"), call(2)]));
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(rows()).toHaveLength(2);
    expect(count()).toBeUndefined();
    expect(view.container.textContent).not.toContain("First decision");
    expect(view.container.textContent).not.toContain("Output 2");
    expect(view.container.textContent).toContain("Details for command 2");
    await click(stepToggle());
    expect(view.container.textContent).toContain("First decision");
    await view.rerender(
      group([think(1, "First decision"), call(2)], { ...context, taskRunning: false }),
    );
    expect(header().getAttribute("aria-expanded")).toBe("false");
  });

  it("expands existing work and keeps a manually folded step closed as other output arrives", async () => {
    mode("expanded");
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

  it("follows the active public thinking label and then the tool caption while preserving row disclosures", async () => {
    mode("compact");
    const first = { ...think(1, "First decision"), streaming: true } as ChatItem;
    const tool = call(2);
    tool.outputComplete = false;
    tool.argumentsText = JSON.stringify({
      cmd: "private command payload",
      description: "确认 QQ 窗口已在前台",
    });
    const view = await mount(group([first]));
    expect(header().textContent).toContain(S.chat.thinking);
    expect(header().textContent).not.toContain("First decision");
    await view.rerender(group([think(1, "First decision"), tool, call(3)]));
    expect(count()).toBe(S.chat.workGroupSteps(3));
    expect(header().textContent).toContain("确认 QQ 窗口已在前台");
    expect(header().textContent).not.toContain("private command payload");
    expect(header().textContent).not.toContain("Details for command 3");
    expect(rows()).toHaveLength(0);
    await click(header());
    await click(stepToggle());
    expect(view.container.textContent).toContain("First decision");
    tool.outputComplete = true;
    await view.rerender(group([think(1, "First decision"), tool, call(3)]));
    expect(header().textContent).toContain("Details for command 3");
    expect(view.container.textContent).toContain("First decision");
    expect(header().querySelector("button, input")).toBeNull();
  });

  it("reveals every loaded detail for find and restores the original folds", async () => {
    mode("compact");
    const items = [think(1, "First decision"), call(2)];
    const view = await mount(group(items));
    await view.rerender(group(items, context, true));
    expect(view.container.textContent).toContain("First decision");
    expect(view.container.textContent).toContain("Output 2");
    await view.rerender(group(items));
    expect(rows()).toHaveLength(0);
    expect(count()).toBe(S.chat.workGroupSteps(2));
    await click(header());
    expect(stepToggle().getAttribute("aria-expanded")).toBe("false");
  });

  it.each(["done", "failed", "stopped"] as const)(
    "keeps two actual steps and the elapsed time after a %s outcome and reload",
    async (state) => {
      mode("compact");
      const last = call(2);
      last.workOutcome = { state, durationMs: 2300 };
      const finished = () =>
        group([think(1, "First decision"), last], { ...context, taskRunning: false });
      await mount(finished());
      const label =
        state === "done"
          ? "Details for command 2"
          : state === "failed"
            ? S.chat.workFailed
            : S.chat.workStopped;
      expect(header().textContent).toContain(label);
      expect(header().getAttribute("data-state")).toBe(state === "failed" ? "error" : "done");
      expect(count()).toBe(S.chat.workGroupSteps(2));
      expect(shownText(header().querySelector("[data-step-elapsed]")!)).toBe("2.3s");
      await click(header());
      expect(rows()).toHaveLength(2);
      await unmountAll();
      await mount(finished());
      expect(header().textContent).toContain(label);
      expect(rows()).toHaveLength(0);
    },
  );

  it.each(["read_file", "edit_file", "write_file"])(
    "summarizes the description and path of a streaming %s in its compact header",
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

  it("opens by itself on a step waiting for approval, and the reader can still close it", async () => {
    mode("compact");
    const item = call(1);
    const pendingApprovals = waitingOn([item]);
    const onApprove = vi.fn(async () => {});
    const ctx = { ...context, pendingApprovals, onApprove };
    const view = await mount(group([think(0, "Plan"), item], ctx));
    expect(header().getAttribute("aria-expanded")).toBe("true");
    expect(hasButton(S.chat.approve)).toBe(true);
    expect(hasButton(S.chat.deny)).toBe(true);
    await click(header());
    expect(hasButton(S.chat.approve)).toBe(false);
    await view.rerender(group([think(0, "Plan"), item, think(2, "Still waiting")], ctx));
    expect(hasButton(S.chat.approve)).toBe(false);
    await click(header());
    await click(button(S.chat.approve));
    expect(onApprove).toHaveBeenCalledWith(item.toolCallId, "allow", []);
  });

  it("exposes outstanding parallel approvals and an active retry without duplicating any action", async () => {
    mode("compact");
    const calls = [call(1), call(2)];
    const pendingApprovals = waitingOn(calls);
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
    expect(rows()).toHaveLength(items.length);
    for (let i = 0; i < calls.length; i++) {
      const item = calls[i]!;
      await click(button(S.chat.approve));
      expect(onApprove).toHaveBeenLastCalledWith(item.toolCallId, "allow", []);
      pendingApprovals.delete(approvalKey([], item.toolCallId));
      await view.rerender(group(items, ctx));
    }
    await click(button(S.chat.requestRetry.retryNow));
    expect(onRetryNow).toHaveBeenCalledOnce();
  });
  it("lists each tool row of an opened compact group with the description and path Standard shows", async () => {
    const file = call(3);
    file.name = "read_file";
    file.argumentsText = JSON.stringify({ file_path: "notes/weekly/plan.md" });
    const items = [think(1, "First decision"), call(2), file];
    const settled = { ...context, taskRunning: false };
    const rowHeads = () =>
      rows().map((row) => row.querySelector("button[aria-expanded]")?.textContent);
    await mount(group(items, settled));
    await click(header());
    const standard = rowHeads();
    expect(standard.join(" ")).toContain("Details for command 2");
    expect(standard.join(" ")).toContain("…/weekly/plan.md");
    await unmountAll();
    mode("compact");
    await mount(group(items, settled));
    await click(header());
    expect(rowHeads()).toEqual(standard);
  });
});
