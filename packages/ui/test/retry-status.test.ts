/**
 * The retry row every retrying surface shares (src/components/feedback/retry-status/), as it
 * first renders. How it moves — the seconds ticking down, a press holding the actions until the
 * next attempt — is an interaction across renders, and the web app's jsdom suite drives it
 * (packages/web/test/retry-status-live.test.ts).
 *
 * - Given any phase, its sentence is on screen and the phase is named on the element; a spinner
 *   turns only while an attempt runs.
 * - Given a wait, the row's sentence carries the seconds to the next attempt, rounding up so it
 *   reaches none only when the moment has come; once it has, or without words for seconds, the
 *   plain sentence shows. Only a wait counts down.
 * - Given a reason, it is not on screen: a circled "?" after the sentence, named for it, holds
 *   it; without one there is no "?".
 * - Given actions, each is a button with its words, and a row without any has none; an action
 *   the caller says is in flight spins and takes no press.
 * - The countdown's seconds: none without a target, never below nothing.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countdownSeconds } from "../src/components/feedback/retry-status/countdown";
import { RetryStatus } from "../src/components/feedback/retry-status/retry-status";
import type {
  RetryPhase,
  RetryStatusProps,
} from "../src/components/feedback/retry-status/retry-status";
import { renderStatic } from "../src/testing";

const NOW = Date.parse("2026-10-18T09:00:00.000Z");

/** The words a piece of markup shows, tags dropped. */
const textOf = (html: string) => html.replace(/<[^>]*>/g, "");
const render = (props: RetryStatusProps) => renderStatic(createElement(RetryStatus, props));
const noop = () => {};
const countdown = (s: number) => `Reconnecting in ${s} s (attempt 4/5)`;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the retry row", () => {
  it.each<RetryPhase>(["trying", "waiting", "retried", "gaveUp", "cancelled", "blocked"])(
    "%s: says where things stand, names its phase, and spins only while an attempt runs",
    (phase) => {
      const html = render({ phase, label: "Where things stand" });
      expect(textOf(html)).toBe("Where things stand");
      expect(html).toContain(`data-retry-phase="${phase}"`);
      expect(html.includes('data-live="spinner"')).toBe(phase === "trying");
    },
  );

  it("while waiting, carries the seconds to the next attempt in its sentence, rounding up", () => {
    const html = render({
      phase: "waiting",
      label: "Reconnecting (attempt 4/5)",
      nextAt: NOW + 22_200,
      countdown,
    });
    expect(textOf(html)).toBe("Reconnecting in 23 s (attempt 4/5)");
  });

  it("says the plain sentence once the moment has come, or without words for seconds, and only a wait counts down", () => {
    const label = "Reconnecting (attempt 4/5)";
    expect(textOf(render({ phase: "waiting", label, nextAt: NOW - 1, countdown }))).toBe(label);
    expect(textOf(render({ phase: "waiting", label, nextAt: NOW + 30_000 }))).toBe(label);
    const stopped = render({ phase: "gaveUp", label: "Failed", nextAt: NOW + 30_000, countdown });
    expect(textOf(stopped)).toBe("Failed");
  });

  it("keeps the reason behind a circled ? after the sentence, named for it, and has no ? without one", () => {
    const html = render({
      phase: "gaveUp",
      label: "Reconnect failed after 5 attempts",
      reason: "Last failure: nas refused the connection.",
    });
    expect(textOf(html)).toBe("Reconnect failed after 5 attempts");
    expect(html).toContain('aria-label="More info: Reconnect failed after 5 attempts"');
    expect(render({ phase: "gaveUp", label: "Failed" })).not.toContain("More info");
  });

  it("draws a button for each action it is given, and none without", () => {
    const both = render({
      phase: "waiting",
      label: "Reconnecting (attempt 4/5)",
      retry: { label: "Retry now", onClick: noop },
      secondary: { label: "Stop retrying", onClick: noop },
    });
    expect(both.match(/<button/g)).toHaveLength(2);
    expect(textOf(both)).toContain("Retry now");
    expect(textOf(both)).toContain("Stop retrying");
    expect(render({ phase: "blocked", label: "Refused" })).not.toContain("<button");
  });

  it("spins an action that is in flight, and it takes no press", () => {
    const html = render({
      phase: "gaveUp",
      label: "Failed",
      retry: { label: "Retry", onClick: noop, busy: true },
    });
    const button = /<button[^>]*>/.exec(html)![0];
    expect(button).toContain('aria-busy="true"');
    expect(button).toMatch(/\sdisabled=""/);
  });
});

describe("the countdown's seconds", () => {
  it("are none without a target, and never fewer than none", () => {
    expect(countdownSeconds(null, NOW)).toBeNull();
    expect(countdownSeconds(undefined, NOW)).toBeNull();
    expect(countdownSeconds(NOW + 1, NOW)).toBe(1);
    expect(countdownSeconds(NOW, NOW)).toBe(0);
    expect(countdownSeconds(NOW - 5_000, NOW)).toBe(0);
  });
});
