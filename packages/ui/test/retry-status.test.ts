/**
 * The retry status every retrying surface shares (src/components/feedback/retry-status/), as it
 * first renders. How it moves — the seconds ticking down, a press holding the buttons until the
 * next attempt — is an interaction across renders, and the web app's jsdom suite drives it
 * (packages/web/test/retry-status-live.test.ts).
 *
 * - Given any phase, the sentence and the reason behind it are on screen and the phase is named
 *   on the element; a spinner turns only while an attempt runs.
 * - Given a wait, the line counts down to the next attempt in whole seconds, rounding up so it
 *   reaches nothing only when the moment has come; once it has, or without words for seconds,
 *   no seconds are shown.
 * - Given actions, each is a button with its words, and a line without any has no buttons; an
 *   action the caller says is in flight spins and takes no press.
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

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the retry status", () => {
  it.each<RetryPhase>(["trying", "waiting", "gaveUp", "blocked"])(
    "%s: says where things stand and why, names its phase, and spins only while an attempt runs",
    (phase) => {
      const html = render({ phase, label: "Where things stand", reason: "Why it is so" });
      expect(textOf(html)).toContain("Where things stand");
      expect(textOf(html)).toContain("Why it is so");
      expect(html).toContain(`data-retry-phase="${phase}"`);
      expect(html.includes('data-live="spinner"')).toBe(phase === "trying");
    },
  );

  it("counts down to the next attempt in whole seconds, rounding up", () => {
    const html = render({
      phase: "waiting",
      label: "Reconnect 3 of 8 failed",
      nextAt: NOW + 39_200,
      countdown: (s) => `next try in ${s} s`,
    });
    expect(textOf(html)).toBe("Reconnect 3 of 8 failed · next try in 40 s");
  });

  it("shows no seconds once the moment has come, or without words for them", () => {
    const countdown = (s: number) => `next try in ${s} s`;
    const due = render({ phase: "waiting", label: "Failed", nextAt: NOW - 1, countdown });
    expect(textOf(due)).toBe("Failed");
    const wordless = render({ phase: "waiting", label: "Failed", nextAt: NOW + 30_000 });
    expect(textOf(wordless)).toBe("Failed");
    // Only a wait counts down: a stopped streak's old schedule says nothing.
    const stopped = render({ phase: "gaveUp", label: "Stopped", nextAt: NOW + 30_000, countdown });
    expect(textOf(stopped)).toBe("Stopped");
  });

  it("draws a button for each action it is given, and none without", () => {
    const both = render({
      phase: "waiting",
      label: "Failed",
      retry: { label: "Retry now", onClick: noop },
      secondary: { label: "Give up", onClick: noop },
    });
    expect(both.match(/<button/g)).toHaveLength(2);
    expect(textOf(both)).toContain("Retry now");
    expect(textOf(both)).toContain("Give up");
    expect(render({ phase: "blocked", label: "Refused" })).not.toContain("<button");
  });

  it("spins an action that is in flight, and it takes no press", () => {
    const html = render({
      phase: "gaveUp",
      label: "Stopped",
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
