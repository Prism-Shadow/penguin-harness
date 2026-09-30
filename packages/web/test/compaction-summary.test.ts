/**
 * What a compaction row shows (lib/omni/compaction-summary.ts and the dictionaries' mode-aware
 * titles). The section timings are stream-model.test.ts's.
 *
 * - The result section reads the summary as prose: tags stripped, an unclosed block shown as
 *   far as it streamed, tagless output verbatim, and nothing when nothing streamed.
 * - The result section stays hidden while the request only thinks, appears with the first
 *   summary text, and stays for a completed row but not for a failed one.
 * - A discard is never titled as a compaction, and an unknown mode falls back to the
 *   compaction title.
 * - The running and settled titles differ, in both modes and both languages, and a discard
 *   never reads as compacting in either state.
 */
import { describe, expect, it } from "vitest";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";
import { compactionResultVisible, compactionSummaryText } from "../src/lib/omni/compaction-summary";

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

describe("compactionTitle (the row is titled by its mode)", () => {
  it("never labels a discard as compaction — the whole point of titling by mode", () => {
    for (const [locale, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      expect(dict.chat.compactionTitle("summarize"), locale).toBeTruthy();
      expect(
        dict.chat.compactionTitle("discard"),
        `${locale} still calls a discard a compaction`,
      ).not.toBe(dict.chat.compactionTitle("summarize"));
    }
  });

  it("falls back to the compaction title for any other mode (an unknown/legacy value)", () => {
    for (const [locale, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      for (const mode of ["", "future-mode"]) {
        expect(dict.chat.compactionTitle(mode), `${locale} ${mode}`).toBe(
          dict.chat.compactionTitle("summarize"),
        );
      }
    }
  });
});

describe("compactionRunning / compactionDone (the title doubles as the status, as the work group's does)", () => {
  it("keeps the two states and the two modes apart in both dictionaries", () => {
    for (const [locale, dict] of [
      ["zh", zh],
      ["en", en],
    ] as const) {
      for (const mode of ["summarize", "discard"]) {
        expect(dict.chat.compactionRunning(mode), `${locale} ${mode}`).toBeTruthy();
        expect(
          dict.chat.compactionRunning(mode),
          `${locale} ${mode} running reads as settled`,
        ).not.toBe(dict.chat.compactionDone(mode));
      }
      // A discard never reads as compacting, in either state — the point of titling by mode.
      expect(dict.chat.compactionRunning("discard"), locale).not.toBe(
        dict.chat.compactionRunning("summarize"),
      );
      expect(dict.chat.compactionDone("discard"), locale).not.toBe(
        dict.chat.compactionDone("summarize"),
      );
    }
  });
});
