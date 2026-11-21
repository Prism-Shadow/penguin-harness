// @vitest-environment jsdom
/**
 * A work group in each display mode (features/chat/work-group.tsx over the UI package's
 * ActivityGroup), driven by the account's mode in the browser cache.
 *
 * - Given Standard, a running group lists its steps closed, each tool row keeping its one-line
 *   description, and folds once the run settles.
 * - Given Expanded, every step is open, and a step the reader folds stays folded as more arrives.
 * - Given Compact, one line pages through the steps without opening them; opening the line lists
 *   every step, and a reader's page and folds survive new steps.
 * - A transcript search reveals every loaded step and restores the page and folds afterwards.
 * - A settled run adds one outcome page that a reopened conversation shows again.
 * - A file tool's streaming description and path appear on its page once each field closes.
 * - Given a step waiting for approval in Compact, the group opens by itself so Approve and Deny
 *   show at once; the reader can still close it. With several waiting, the hourglass visits each.
 * - Given Compact, an opened group lists each tool row with the description and path Standard
 *   shows.
 * - Given Compact, the run's total shows as the time alone, at the end of the line after the pager.
 * - Given Compact, a step number typed into the pager and confirmed with Enter is the page shown,
 *   and stays shown as more steps arrive; a number past either end lands on that end, text that
 *   is not a number goes nowhere, and Escape puts the current step back without moving.
 */
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
import { button, click, field, hasButton, mount, run, type, unmountAll } from "./helpers/dom";

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
const position = () => document.querySelector("[data-step-navigation]")?.getAttribute("aria-label");
/** The pager's readout for a step, as the step words put it around the number. */
const stepLabel = (n: number) => `${S.chat.workStepWords[0]}${n}${S.chat.workStepWords[1]}`;
const stepNumber = () => field(S.chat.workStepJump) as HTMLInputElement;
const press = (target: Element, key: string) =>
  run(() =>
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })),
  );
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
    expect(position()).toBeUndefined();
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

  it("keeps a compact step collapsed while paging", async () => {
    mode("compact");
    const first = think(1, "First decision");
    const view = await mount(group([first, call(2)]));
    expect(position()).toBe(stepLabel(2));
    expect(rows()).toHaveLength(0);
    await click(button(S.chat.previousWorkStep));
    expect(rows()).toHaveLength(0);
    await click(header());
    expect(rows()).toHaveLength(2);
    expect(view.container.textContent).not.toContain("First decision");
    await click(stepToggle());
    expect(view.container.textContent).toContain("First decision");
    await view.rerender(group([first, call(2), think(3, "Later decision")]));
    expect(position()).toBe(stepLabel(1));
    await click(button(S.chat.nextWorkStep));
    expect(rows()).toHaveLength(3);
    expect(view.container.textContent).toContain("First decision");
    expect(view.container.textContent).not.toContain("Output 2");
    await click(button(S.chat.previousWorkStep));
    expect(view.container.textContent).toContain("First decision");
    await click(button(S.chat.latestWorkStep));
    await view.rerender(group([first, call(2), think(3, "Later decision"), call(4)]));
    expect(position()).toBe(stepLabel(4));
  });

  it("updates the current page in place, reveals all loaded text for find and restores both folds", async () => {
    mode("compact");
    const first = think(1, "First decision"),
      tool = call(2);
    const view = await mount(group([first, tool]));
    tool.output = "Updated output";
    await view.rerender(group([first, tool]));
    expect(position()).toBe(stepLabel(2));
    await click(button(S.chat.previousWorkStep));
    await view.rerender(group([first, tool, think(3, "More work")], context, true));
    expect(position()).toBeUndefined();
    for (const phrase of ["First decision", "Updated output", "More work"])
      expect(view.container.textContent).toContain(phrase);
    await view.rerender(group([first, tool, think(3, "More work")]));
    expect(rows()).toHaveLength(0);
    expect(position()).toBe(stepLabel(1));
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
      expect(position()).toBe(stepLabel(1));
      second.workOutcome = { state, durationMs: 2300 };
      const finished = () => group([first, second], { ...context, taskRunning: false });
      await view.rerender(finished());
      expect(position()).toBe(stepLabel(1));
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
      expect(position()).toBe(stepLabel(3));
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
    await click(button(S.chat.waitingWorkStep));
    await click(button(S.chat.approve));
    expect(onApprove).toHaveBeenCalledWith(item.toolCallId, "allow", []);
  });

  it("cycles through outstanding parallel approvals and an active retry without duplicating any action", async () => {
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
      await click(button(S.chat.waitingWorkStep));
      expect(position()).toBe(stepLabel(i + 1));
      const item = calls[i]!;
      await click(button(S.chat.approve));
      expect(onApprove).toHaveBeenLastCalledWith(item.toolCallId, "allow", []);
      pendingApprovals.delete(approvalKey([], item.toolCallId));
      await view.rerender(group(items, ctx));
    }
    await click(button(S.chat.waitingWorkStep));
    expect(position()).toBe(stepLabel(3));
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

  it("shows the run's total as the time alone, at the end of the line after the pager", async () => {
    mode("compact");
    const second = call(2);
    second.workOutcome = { state: "done", durationMs: 2300 };
    await mount(group([think(1, "First decision"), second], { ...context, taskRunning: false }));
    const head = document.querySelector("[data-step-head]")!;
    const elapsed = head.querySelector("[data-step-elapsed]")!;
    expect(shownText(elapsed).trim()).toBe("2.3s");
    expect(head.lastElementChild).toBe(elapsed);
    expect(elapsed.previousElementSibling?.hasAttribute("data-step-navigation")).toBe(true);
  });

  it("goes to the step typed into the pager on Enter, and stays there as more steps arrive", async () => {
    mode("compact");
    const items = [think(1, "First decision"), call(2), think(3, "Third"), call(4)];
    const view = await mount(group(items));
    expect(stepNumber().value).toBe("4");
    await type(stepNumber(), "2");
    await press(stepNumber(), "Enter");
    expect(position()).toBe(stepLabel(2));
    expect(stepNumber().value).toBe("2");
    expect(rows()).toHaveLength(0);
    await view.rerender(group([...items, think(5, "Fifth")]));
    expect(position()).toBe(stepLabel(2));
  });

  it("lands a step number past either end on that end, and ignores one that is not a number", async () => {
    mode("compact");
    await mount(group([think(1, "First decision"), call(2), think(3, "Third")]));
    await type(stepNumber(), "99");
    await press(stepNumber(), "Enter");
    expect(position()).toBe(stepLabel(3));
    await type(stepNumber(), "0");
    await press(stepNumber(), "Enter");
    expect(position()).toBe(stepLabel(1));
    await type(stepNumber(), "two");
    await press(stepNumber(), "Enter");
    expect(position()).toBe(stepLabel(1));
    expect(stepNumber().value).toBe("1");
  });

  it("puts the current step back on Escape without moving", async () => {
    mode("compact");
    await mount(group([think(1, "First decision"), call(2), think(3, "Third")]));
    await type(stepNumber(), "1");
    await press(stepNumber(), "Escape");
    expect(stepNumber().value).toBe("3");
    await press(stepNumber(), "Enter");
    expect(position()).toBe(stepLabel(3));
  });
});
