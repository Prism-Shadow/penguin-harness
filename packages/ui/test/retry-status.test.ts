/**
 * The machine's retry row (src/components/feedback/retry-status/), as it first renders. How it moves — the seconds ticking down, a press holding the actions until the
 * next attempt — is an interaction across renders, and the web app's jsdom suite drives it
 * (packages/web/test/retry-status-live.test.ts).
 *
 * - Given any phase, its sentence is on screen and the phase is named on the element; a spinner
 *   turns only while an attempt runs.
 * - Given a wait, the row's sentence carries the seconds to the next attempt, rounding up so it
 *   reaches none only when the moment has come; once it has, or without words for seconds, the
 *   plain sentence shows. Only a wait counts down.
 * - Given a reason, it is on the row after the sentence, in sight; there is never a "?" to
 *   hover for it, with a reason or without.
 * - Given actions, each is a button with its words, and a row without any has none; an action
 *   the caller says is in flight spins and takes no press.
 * - The countdown's seconds: none without a target, never below nothing; their place in the
 *   caller's sentence is found wherever its language puts them, so they can keep their width.
 */
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  countdownParts,
  countdownSeconds,
} from "../src/components/feedback/retry-status/countdown";
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
  it.each<RetryPhase>(["trying", "waiting", "gaveUp", "cancelled", "blocked"])(
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

  it("says its reason after the sentence, in sight, and has no ? with a reason or without", () => {
    const html = render({
      phase: "gaveUp",
      label: "Reconnect failed after 5 attempts",
      reason: "nas refused the connection.",
    });
    expect(textOf(html)).toBe("Reconnect failed after 5 attempts · nas refused the connection.");
    expect(html).not.toContain("More info");
    expect(html).not.toContain("<button");
    expect(render({ phase: "gaveUp", label: "Failed" })).not.toContain("<button");
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
  it("are found in the caller's sentence wherever its language puts them, and not where it shows none", () => {
    expect(countdownParts((s) => `Retrying in ${s} s (attempt 4/10)`)).toEqual({
      before: "Retrying in ",
      after: " s (attempt 4/10)",
    });
    expect(countdownParts((s) => `第 4/10 次请求将在 ${s} 秒后发起`)).toEqual({
      before: "第 4/10 次请求将在 ",
      after: " 秒后发起",
    });
    expect(countdownParts(() => "Retrying shortly")).toBeNull();
  });

  it("are none without a target, and never fewer than none", () => {
    expect(countdownSeconds(null, NOW)).toBeNull();
    expect(countdownSeconds(undefined, NOW)).toBeNull();
    expect(countdownSeconds(NOW + 1, NOW)).toBe(1);
    expect(countdownSeconds(NOW, NOW)).toBe(0);
    expect(countdownSeconds(NOW - 5_000, NOW)).toBe(0);
  });
});
