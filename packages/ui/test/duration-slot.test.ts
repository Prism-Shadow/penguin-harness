/**
 * The duration slot (src/components/feedback/duration-slot/): the two duration forms the app and
 * the CLI print, and the slot that shows the live clock while running and the settled duration
 * after.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import {
  DurationSlot,
  LiveDuration,
  formatDuration,
  formatDurationLive,
} from "../src/components/feedback/duration-slot/duration-slot";
import { classTokens, renderStatic } from "../src/testing";

describe("formatDuration", () => {
  it("keeps a tenth below a minute, and whole seconds past it", () => {
    expect(formatDuration(820)).toBe("820ms");
    expect(formatDuration(2300)).toBe("2.3s");
    expect(formatDuration(63_000)).toBe("1m3s");
    expect(formatDuration(119_700)).toBe("2m0s");
    expect(formatDuration(12_700, { compact: true })).toBe("13s");
    expect(formatDuration(1700, { compact: true })).toBe("1.7s");
  });
});

describe("formatDurationLive", () => {
  it("counts whole seconds up, never early, and reads a negative span as zero", () => {
    expect(formatDurationLive(7999)).toBe("7s");
    expect(formatDurationLive(63_000)).toBe("1m3s");
    expect(formatDurationLive(-500)).toBe("0s");
  });
});

describe("DurationSlot", () => {
  it("shows the settled duration in tabular figures, and nothing before one is known", () => {
    const html = renderStatic(createElement(DurationSlot, { running: false, durationMs: 2300 }));
    expect(html).toContain(">2.3s</span>");
    expect(classTokens(html)).toEqual(expect.arrayContaining(["font-mono", "tabular-nums"]));
    expect(renderStatic(createElement(DurationSlot, { running: false }))).toBe("");
  });

  it("holds a still ellipsis while running with no start known", () => {
    expect(renderStatic(createElement(LiveDuration, {}))).toBe("…");
    const html = renderStatic(createElement(DurationSlot, { running: true }));
    expect(html).toContain(">…</span>");
    expect(html).not.toContain("animate-");
  });
});
