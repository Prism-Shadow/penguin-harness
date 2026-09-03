/**
 * What a compaction row shows: the text inside its result section (compaction-summary.ts)
 * and the title above it (the dictionaries' mode-aware `compactionTitle`).
 *
 * The row itself is a StepBanner whose body stacks a thinking section and a result section.
 * The banner opens while the compaction runs and closes itself once it settles; the two
 * sections stay closed throughout, showing only their labels and their wall times — the
 * reader expands one to watch the request think or write, or to read the outcome afterwards.
 * What the result section then contains is this pure helper's job, and it is what these tests
 * pin; the section timings behind those wall times are pinned in stream-model.test.ts (the
 * Web suite runs in a node environment and renders no React).
 */
import { describe, expect, it } from "vitest";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";
import { compactionSummaryText } from "../src/lib/omni/compaction-summary";

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
