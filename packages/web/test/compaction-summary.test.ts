/**
 * What a compaction row shows (lib/amsp/compaction-summary.ts, and the row's title in
 * features/chat/compaction-banner.tsx). The section timings are stream-model.test.ts's.
 *
 * - The result section reads the summary as prose: tags stripped, an unclosed block shown as
 *   far as it streamed, tagless output verbatim, and nothing when nothing streamed.
 * - The result section stays hidden while the request only thinks, appears with the first
 *   summary text, and stays for a completed row but not for a failed one.
 * - A discard row is never titled as a compaction, running or settled, and a running row never
 *   reads as settled; an unknown mode is titled as a compaction — in both languages.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompactionMode } from "@prismshadow/amsp";
import { CompactionBanner } from "../src/features/chat/compaction-banner";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { compactionResultVisible, compactionSummaryText } from "../src/lib/amsp/compaction-summary";

describe("compactionSummaryText", () => {
  it("strips the summary tags so the body reads as prose", () => {
    expect(compactionSummaryText({ summaryText: "[summary]the plan[/summary]" })).toBe("the plan");
  });

  it("shows a summary still mid-stream, before the model closes the block", () => {
    // The body streams while collapsed: an unclosed `[summary]` must read as the text so
    // far, not vanish until the closing tag arrives.
    expect(compactionSummaryText({ summaryText: "[summary]writing the pl" })).toBe(
      "writing the pl",
    );
  });

  it("uses tagless output verbatim (core's lenient extraction)", () => {
    expect(compactionSummaryText({ summaryText: "no tags at all" })).toBe("no tags at all");
  });

  it("is empty when nothing streamed — a discard compaction, or a failed one whose draft was discarded", () => {
    expect(compactionSummaryText({})).toBe("");
    expect(compactionSummaryText({ summaryText: "" })).toBe("");
    expect(compactionSummaryText({ summaryText: "   " })).toBe("");
  });
});

describe("compactionResultVisible (the result section waits for the thinking to finish)", () => {
  it("stays hidden while the request is still thinking and no summary has started", () => {
    expect(
      compactionResultVisible({ running: true, summaryText: "", summaryStartedAtMs: undefined }),
    ).toBe(false);
    expect(compactionResultVisible({ running: true })).toBe(false);
  });

  it("appears with the first summary text, which is what ends the thinking", () => {
    expect(compactionResultVisible({ running: true, summaryStartedAtMs: 1000 })).toBe(true);
    expect(compactionResultVisible({ running: true, summaryText: "<summary>x" })).toBe(true);
  });

  it("is shown on a completed row, and never on one that failed with its drafts discarded", () => {
    expect(compactionResultVisible({ running: false, status: "completed" })).toBe(true);
    expect(compactionResultVisible({ running: false, status: "fatal" })).toBe(false);
    expect(compactionResultVisible({ running: false, status: "aborted" })).toBe(false);
  });
});

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("a compaction row's title (%s)", (_locale, dict) => {
  beforeEach(() => setActiveStrings(dict));
  afterEach(() => setActiveStrings(zh));

  /** The row as the transcript draws it: running, or settled as completed. */
  const row = (mode: string, running: boolean) =>
    renderToStaticMarkup(
      createElement(CompactionBanner, {
        item: {
          kind: "compaction",
          id: 1,
          reason: "manual",
          mode: mode as CompactionMode,
          running,
          ...(running ? {} : { status: "completed" as const }),
        },
      }),
    );

  it("never titles a discard as a compaction, running or settled", () => {
    expect(row("discard", true)).toContain(dict.chat.compactionRunning("discard"));
    expect(row("discard", true)).not.toContain(dict.chat.compactionRunning("summarize"));
    expect(row("discard", false)).toContain(dict.chat.compactionDone("discard"));
    expect(row("discard", false)).not.toContain(dict.chat.compactionDone("summarize"));
  });

  it("never titles a running row as settled", () => {
    expect(row("summarize", true)).toContain(dict.chat.compactionRunning("summarize"));
    expect(row("summarize", true)).not.toContain(dict.chat.compactionDone("summarize"));
  });

  it("titles a mode it does not know as a compaction", () => {
    expect(row("future-mode", false)).toContain(dict.chat.compactionDone("summarize"));
  });
});
