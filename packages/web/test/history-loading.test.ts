// @vitest-environment jsdom
/**
 * The transcript's place while a conversation's history loads (features/chat/history-loading.tsx).
 *
 * - Given a conversation on a machine, the skeleton stands for the first second — a fast read
 *   never flashes anything else — and then the transfer row says how far the messages have come:
 *   the amount against the whole, and a bar with the same reading.
 * - Given the hub waiting for the machine, the link's retry row sits under the transfer row, and
 *   its Retry now reads the window again.
 * - Given a conversation on this server, whose reads report no progress, the skeleton stays.
 */
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HistoryProgress } from "@prismshadow/penguin-server/api";
import { HistoryLoading } from "../src/features/chat/history-loading";
import { S } from "../src/lib/strings";
import { button, click, mount, run, unmountAll } from "./helpers/dom";

beforeEach(() => {
  // Fake time that also moves with real time: the DOM helpers settle on a zero-delay timer.
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
});

const KIB = 1024;
const progress = (waiting: HistoryProgress["waiting"] = null): HistoryProgress => ({
  phase: "window",
  machineId: "m1",
  doneBytes: 120 * KIB,
  totalBytes: 380 * KIB,
  doneLines: 40,
  totalLines: 120,
  waiting,
});

const bar = (container: HTMLElement) => container.querySelector('[role="progressbar"]');

describe("the transcript's place while history loads", () => {
  it("shows the skeleton for a second, then how far a machine's messages have come", async () => {
    const onRetryNow = vi.fn();
    const { container } = await mount(
      h(HistoryLoading, { projectId: "p", sessionId: "s1", progress: progress(), onRetryNow }),
    );
    expect(bar(container)).toBeNull();
    await run(() => vi.advanceTimersByTime(1_000));
    expect(container.textContent).toContain("120 / 380 KB");
    expect(bar(container)?.getAttribute("aria-valuenow")).toBe(String(120 * KIB));
    expect(bar(container)?.getAttribute("aria-valuemax")).toBe(String(380 * KIB));
  });

  it("puts the link's retry under the row while the hub waits, and Retry now reads the window again", async () => {
    const onRetryNow = vi.fn();
    const waiting = { reason: "retrying" as const, attempt: 2, nextAt: Date.now() + 6_000 };
    await mount(
      h(HistoryLoading, {
        projectId: "p",
        sessionId: "s1",
        progress: progress(waiting),
        onRetryNow,
      }),
    );
    await run(() => vi.advanceTimersByTime(1_000));
    await click(button(S.chat.historyTransfer.retryNow));
    expect(onRetryNow).toHaveBeenCalledTimes(1);
  });

  it("keeps the skeleton for a conversation on this server", async () => {
    const { container } = await mount(
      h(HistoryLoading, { projectId: "p", sessionId: "s1", progress: null, onRetryNow: () => {} }),
    );
    await run(() => vi.advanceTimersByTime(5_000));
    expect(bar(container)).toBeNull();
    expect(container.textContent).toBe("");
  });
});
