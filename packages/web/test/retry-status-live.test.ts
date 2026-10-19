// @vitest-environment jsdom
/**
 * The shared retry status as it lives on a page — the UI package's `RetryStatus`, which the
 * Machines card and dialog show and whose buttons the chat's reconnect notice holds — across
 * renders, on a fake clock.
 *
 * - Given a wait 40 s out, a second later the line shows a second less; when the moment comes the
 *   seconds go and the sentence stays.
 * - Given Retry now pressed twice, one retry is asked for; the button stays held until the next
 *   attempt begins, and then takes a press again.
 * - Given a retry the server refused (its promise rejects), the button takes a press again at once.
 */
import { act, createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RetryStatus } from "@prismshadow/penguin-ui";
import type { RetryStatusProps } from "@prismshadow/penguin-ui";
import { mount, unmountAll } from "./helpers/dom";

const NOW = Date.parse("2026-10-18T09:00:00.000Z");

const waiting = (over: Partial<RetryStatusProps> = {}): RetryStatusProps => ({
  phase: "waiting",
  label: "Reconnect 3 of 8 failed",
  nextAt: NOW + 40_000,
  countdown: (s) => `next try in ${s} s`,
  ...over,
});

/** A click as the pointer delivers it; the fake clock leaves the DOM helper's settling out. */
async function press(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  });
}
async function elapse(ms: number): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
const seconds = (root: Element) =>
  root.querySelector("[data-retry-countdown]")?.textContent?.trim() ?? null;
const retryButton = (root: Element) =>
  root.querySelector<HTMLButtonElement>('[data-retry-action="retry"]')!;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(async () => {
  await unmountAll();
  vi.useRealTimers();
});

describe("the retry status on a page", () => {
  it("counts down a second at a time, and drops the seconds when the moment comes", async () => {
    const { container } = await mount(h(RetryStatus, waiting()));
    expect(seconds(container)).toBe("· next try in 40 s");
    await elapse(1_100);
    expect(seconds(container)).toBe("· next try in 39 s");
    await elapse(40_000);
    expect(seconds(container)).toBeNull();
    expect(container.textContent).toContain("Reconnect 3 of 8 failed");
  });

  it("asks once for two presses, holds the button until the next attempt, then takes a press again", async () => {
    const onClick = vi.fn(async () => {});
    const shown = await mount(h(RetryStatus, waiting({ retry: { label: "Retry now", onClick } })));
    await press(retryButton(shown.container));
    await press(retryButton(shown.container));
    expect(onClick).toHaveBeenCalledOnce();
    expect(retryButton(shown.container).disabled).toBe(true);
    // The server's answer: that attempt ran and failed, and the next one is scheduled.
    await shown.rerender(
      h(
        RetryStatus,
        waiting({
          label: "Reconnect 4 of 8 failed",
          nextAt: NOW + 80_000,
          retry: { label: "Retry now", onClick },
        }),
      ),
    );
    expect(retryButton(shown.container).disabled).toBe(false);
    await press(retryButton(shown.container));
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("takes a press again at once when the server refused the retry", async () => {
    const onClick = vi.fn(() => Promise.reject(new Error("refused")));
    const { container } = await mount(
      h(RetryStatus, waiting({ retry: { label: "Retry now", onClick } })),
    );
    await press(retryButton(container));
    await act(async () => {
      await Promise.resolve();
    });
    expect(retryButton(container).disabled).toBe(false);
    await press(retryButton(container));
    expect(onClick).toHaveBeenCalledTimes(2);
  });
});
