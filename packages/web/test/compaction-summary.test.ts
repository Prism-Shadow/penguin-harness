/**
 * What a compaction row shows (lib/amsp/compaction-summary.ts, and the row's title in
 * features/chat/compaction-banner.tsx). The section timings are stream-model.test.ts's.
 *
 * - The result section reads the summary as prose: tags stripped, an unclosed block shown as
 *   far as it streamed, tagless output verbatim, and nothing when nothing streamed.
 * - The result section stays hidden while the request only thinks, appears with the first
 *   summary text, and stays for a completed row but not for a failed one or one that completed
 *   without a full summary.
 * - A discard row is never titled as a compaction, running or settled, and a running row never
 *   reads as settled; an unknown mode is titled as a compaction — in both languages.
 * - A completion without a full summary is titled as compacted and says why only through its
 *   status mark's name and tooltip, with no result section; when too little room was left (a
 *   refusal, a summary cut off at the output limit) the mark says what to correct, and quotes
 *   the provider only when the provider refused. A fatal end keeps the failed row, and an old
 *   Trace's abandoned compactions keep their own reason lines — in both languages.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompactionMode } from "@prismshadow/amsp";
import { CompactionBanner } from "../src/features/chat/compaction-banner";
import type { StreamRenderContext } from "../src/features/chat/message-stream";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { compactionResultVisible, compactionSummaryText } from "../src/lib/amsp/compaction-summary";
import type { CompactionItem } from "../src/lib/amsp/stream-model";

/** A string as React writes it into an attribute value in static markup. */
const attribute = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

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

  it("is never shown on a completion without a full summary", () => {
    expect(
      compactionResultVisible({
        running: false,
        status: "completed",
        errorCode: "rejected",
        errorMessage: "400 Bad Request",
      }),
    ).toBe(false);
    expect(
      compactionResultVisible({ running: false, status: "completed", errorCode: "network" }),
    ).toBe(false);
  });
});

describe.each([
  ["zh", zh],
  ["en", en],
] as const)("a compaction row's title (%s)", (_locale, dict) => {
  beforeEach(() => setActiveStrings(dict));
  afterEach(() => setActiveStrings(zh));

  /** The main Session's render context, with nothing pending. */
  const ctx: StreamRenderContext = {
    pendingApprovals: new Map(),
    onApprove: async () => {},
    origin: [],
    taskRunning: false,
  };

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
        ctx,
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

  /** A settled summarize row as the reducer leaves it. */
  const settled = (fields: Partial<CompactionItem>) =>
    renderToStaticMarkup(
      createElement(CompactionBanner, {
        item: {
          kind: "compaction",
          id: 1,
          reason: "context",
          mode: "summarize",
          running: false,
          ...fields,
        },
        ctx,
      }),
    );

  it("says a completion without a full summary on its status mark alone: titled as compacted, the reason as the mark's name and tooltip", () => {
    const unusable = "the response contained no usable summary";
    const refusal = "400 prompt is too long: 140000 tokens > 131072 maximum";
    const cases = [
      // Any other cause: the one degraded sentence, with its reason.
      [
        settled({ status: "completed", errorCode: "malformed", errorMessage: unusable }),
        dict.chat.compactionDegradedHint(unusable),
      ],
      // Too little room: what to correct, and the provider's words when it refused.
      [
        settled({ status: "completed", errorCode: "rejected", errorMessage: refusal }),
        dict.chat.compactionRoomHint(refusal),
      ],
      // A summary cut off at the output limit: the reason is the harness's, so no one is quoted.
      [
        settled({
          status: "completed",
          errorCode: "output_truncated",
          errorMessage: "the response stopped at the output limit (finish_reason: length)",
        }),
        dict.chat.compactionRoomHint(),
      ],
    ] as const;
    for (const [html, hint] of cases) {
      expect(html).toContain(dict.chat.compactionDone("summarize"));
      expect(html).toContain(`aria-label="${attribute(hint)}"`);
      expect(html).toContain(`data-tooltip="${attribute(hint)}"`);
      // Nothing is written into the row itself: no reason line under the title.
      expect(html).not.toContain(attribute(dict.chat.compactionFailed("fatal", refusal)));
    }
    expect(cases[1][0]).toContain(attribute(refusal));
    expect(cases[2][0]).not.toContain("finish_reason");
    // A full summary's mark stays the plain settled glyph, with nothing to name.
    const plain = settled({ status: "completed", summaryText: "[summary]x" });
    for (const [, hint] of cases) expect(plain).not.toContain(`aria-label="${attribute(hint)}"`);
  });

  it("keeps a failed row for a compaction whose next context could not be opened, and an old Trace's abandoned ones read as before", () => {
    const fatal = settled({ status: "fatal", errorMessage: "no client" });
    expect(fatal).toContain(dict.chat.compactionTitle("summarize"));
    expect(fatal).not.toContain(dict.chat.compactionDone("summarize"));
    expect(fatal).toContain(dict.chat.compactionFailed("fatal", "no client"));
    for (const legacy of ["retryable", "failed"] as const) {
      // `failed` is an old Trace's spelling, outside today's StopReason.
      const html = settled({
        status: legacy as CompactionItem["status"],
        errorMessage: "no client",
      });
      expect(html).toContain(dict.chat.compactionFailed(legacy, "no client"));
      expect(html).not.toContain(dict.chat.compactionFailed("fatal", "no client"));
    }
  });
});
