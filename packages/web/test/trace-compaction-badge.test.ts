/**
 * The Trace round card's compaction badge (trace-file-view's `compactionBadgeLabel`).
 *
 * The badge deliberately reuses the chat stream's mode-aware row title instead of a
 * Trace-local string, so a discarded round is named the same thing in both places. These
 * tests pin that reuse, the backward-compatible fallback for a round analyzed before the
 * server carried the mode, and the fact that `compaction` alone still gates the badge.
 * (The Web suite runs in a node environment and renders no React, so the pure helper is
 * what gets exercised — the same approach as agent-settings-options.test.ts.)
 */
import { afterEach, describe, expect, it } from "vitest";
import { en } from "../src/lib/strings-en";
import { setActiveStrings, zh } from "../src/lib/strings";
import { compactionBadgeLabel } from "../src/features/traces/trace-file-view";

// S is a live binding shared across the suite: always hand it back the default.
afterEach(() => setActiveStrings(zh));

describe("compactionBadgeLabel", () => {
  it("shows nothing for a round that is not a compaction turn", () => {
    expect(compactionBadgeLabel(undefined)).toBeNull();
    expect(compactionBadgeLabel({ taskIndex: 0 } as never)).toBeNull();
    // The flag is the sole gate: a mode without the flag is not a compaction round.
    expect(compactionBadgeLabel({ taskIndex: 0, compactionMode: "discard" } as never)).toBeNull();
  });

  it("names the mode, so a discarded round is never badged as compaction", () => {
    const summarize = { taskIndex: 1, compaction: true, compactionMode: "summarize" } as never;
    const discard = { taskIndex: 1, compaction: true, compactionMode: "discard" } as never;

    expect(compactionBadgeLabel(summarize)).toBe("压缩");
    expect(compactionBadgeLabel(discard)).toBe("清空");

    setActiveStrings(en);
    expect(compactionBadgeLabel(summarize)).toBe("Compaction");
    expect(compactionBadgeLabel(discard)).toBe("Clear");
  });

  it("reuses the chat row's title rather than a second Trace-local pair of strings", () => {
    const discard = { taskIndex: 1, compaction: true, compactionMode: "discard" } as never;
    expect(compactionBadgeLabel(discard)).toBe(zh.chat.compactionTitle("discard"));
    setActiveStrings(en);
    expect(compactionBadgeLabel(discard)).toBe(en.chat.compactionTitle("discard"));
  });

  it("falls back to the compaction title when the mode is absent (a round analyzed by an older server)", () => {
    const legacy = { taskIndex: 1, compaction: true } as never;
    expect(compactionBadgeLabel(legacy)).toBe("压缩");
    setActiveStrings(en);
    expect(compactionBadgeLabel(legacy)).toBe("Compaction");
  });
});
