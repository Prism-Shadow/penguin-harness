// @vitest-environment jsdom
import { act, createElement as h } from "react";
import { toolCall } from "@prismshadow/amsp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyThemeAttributes } from "@prismshadow/penguin-ui/boot";
import { ThemeProvider } from "../src/state/theme";
import { SessionWorkGroup } from "../src/features/chat/work-group";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import { FindRevealContext } from "../src/lib/find-expand";
import { approvalKey, type ChatItem, type ToolCallItem } from "../src/lib/amsp/stream-model";
import { S } from "../src/lib/strings";
import { memoryStorage, stubLocalStorage } from "./helpers/storage";
import { button, click, mount, unmountAll } from "./helpers/dom";

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
  argumentsText: JSON.stringify({ cmd: `echo ${id}` }),
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
  stubLocalStorage(memoryStorage({ "penguin.themeId": "doodle" }));
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(unmountAll);
describe("live work pages", () => {
  it.each(["modern", "github", "geek"])(
    "keeps %s chronological while allowing a live switch to and from Doodle",
    async (themeId) => {
      stubLocalStorage(memoryStorage({ "penguin.themeId": themeId }));
      const view = await mount(
        group([think(1, "First decision"), call(2), think(3, "Another decision")]),
      );
      const rows = () => view.container.querySelectorAll(".ui-tree > [data-depth]").length;
      expect(rows()).toBe(3);
      expect(position()).toBeUndefined();
      const change = (id: string) =>
        act(async () => {
          applyThemeAttributes(document.documentElement, { themeId: id });
        });
      await change("doodle");
      expect(rows()).toBe(1);
      expect(position()).toBe(S.chat.workStepPosition(3, 3));
      await click(button(S.chat.previousWorkStep));
      await change(themeId);
      expect(rows()).toBe(3);
      expect(position()).toBeUndefined();
      expect(view.container.textContent).toContain(S.chat.workGroupSteps(1));
      await change("doodle");
      expect(position()).toBe(S.chat.workStepPosition(2, 3));
      expect(view.container.textContent).toContain("Output 2");
    },
  );

  it("tracks new steps by identity, keeps a manual page and its disclosure through updates and find", async () => {
    const first = think(1, "First decision");
    const second = call(2);
    const third = think(3, "Next decision");
    const view = await mount(group([first, second]));
    const text = () => view.container.textContent;
    expect(position()).toBe(S.chat.workStepPosition(2, 2));
    expect(text()).toContain("Output 2");
    second.output = "Updated output";
    await view.rerender(group([first, second]));
    expect(position()).toBe(S.chat.workStepPosition(2, 2));
    expect(text()).toContain("Updated output");
    await click(button(S.chat.previousWorkStep));
    const row = () =>
      view.container.querySelector<HTMLButtonElement>('.ui-tree button[data-kind="thinking"]')!;
    await click(row());
    expect(row().getAttribute("aria-expanded")).toBe("false");
    await view.rerender(group([first, second, third]));
    expect(position()).toBe(S.chat.workStepPosition(1, 3));
    await view.rerender(group([first, second, third], context, true));
    expect(position()).toBeUndefined();
    for (const phrase of ["First decision", "Updated output", "Next decision"])
      expect(text()).toContain(phrase);
    await view.rerender(group([first, second, third]));
    expect(position()).toBe(S.chat.workStepPosition(1, 3));
    expect(row().getAttribute("aria-expanded")).toBe("false");
    await click(button(S.chat.latestWorkStep));
    expect(position()).toBe(S.chat.workStepPosition(3, 3));
    await view.rerender(group([first, second, third, call(4)]));
    expect(position()).toBe(S.chat.workStepPosition(4, 4));
    await click(button(S.chat.previousWorkStep));
    await view.rerender(group([first, second, third, call(4)], { ...context, taskRunning: false }));
    expect(position()).toBe(S.chat.workStepPosition(3, 4));
    expect(text()).toContain("Next decision");
    await click(view.container.querySelector("[data-group-header]")!);
    await click(view.container.querySelector("[data-group-header]")!);
    expect(position()).toBe(S.chat.workStepPosition(4, 4));
    await unmountAll();
    const history = await mount(group([first, second, third], { ...context, taskRunning: false }));
    await click(history.container.querySelector("[data-group-header]")!);
    expect(history.container.querySelectorAll(".ui-tree > [data-depth]")).toHaveLength(3);
    expect(position()).toBeUndefined();
  });

  it.each(["fatal", "aborted"] as const)(
    "keeps a %s tool's status and output available after the run",
    async (status) => {
      const finalCall = call(2);
      const first = think(1, "Inspect first");
      const view = await mount(group([first, finalCall]));
      await click(button(S.chat.previousWorkStep));
      finalCall.output = "The tool ended before producing a result.";
      finalCall.outputStatus = status;
      await view.rerender(group([first, finalCall], { ...context, taskRunning: false }));
      expect(position()).toBe(S.chat.workStepPosition(1, 2));
      await click(button(S.chat.latestWorkStep));
      expect(view.container.querySelector('[data-kind="tool"][data-state="error"]')).not.toBeNull();
      expect(view.container.textContent).toContain(finalCall.output);
    },
  );

  it("cycles through outstanding parallel approvals and an active retry without duplicating any action", async () => {
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
    for (let i = 0; i < calls.length; i++) {
      await click(button(S.chat.waitingWorkStep));
      expect(position()).toBe(S.chat.workStepPosition(i + 1, 4));
      const item = calls[i]!;
      await click(button(S.chat.approve));
      expect(onApprove).toHaveBeenLastCalledWith(item.toolCallId, "allow", []);
      pendingApprovals.delete(approvalKey([], item.toolCallId));
      await view.rerender(group(items, ctx));
    }
    await click(button(S.chat.waitingWorkStep));
    expect(position()).toBe(S.chat.workStepPosition(3, 4));
    await click(button(S.chat.requestRetry.retryNow));
    expect(onRetryNow).toHaveBeenCalledOnce();
  });
});
