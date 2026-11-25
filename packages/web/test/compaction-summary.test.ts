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
 *   status mark's name and tooltip, with no result section, one line each: the cause first (in
 *   words with the HTTP status the error names, then the error's own words, or those words alone
 *   for a code with no words), then what was done; when too little room was left (a refusal, a
 *   summary cut off at the output limit) a third line says what to correct. A fatal end keeps
 *   the failed row, and an old Trace's abandoned compactions keep their own reason lines — in
 *   both languages.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CompactionMode } from "@prismshadow/amsp";
import { CompactionBanner } from "@prismshadow/penguin-library-session/web/chat/compaction-banner";
import type { StreamRenderContext } from "@prismshadow/penguin-library-session/web/chat/message-stream";
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

/** An attribute value from static markup, read back as the text it holds. */
const unattribute = (value: string): string =>
  value
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");

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

  /**
   * The degraded mark's accessible name, one entry per line, after checking its tooltip says the
   * same; null when the row carries no such mark.
   */
  const markLines = (html: string): string[] | null => {
    const found = /role="img" aria-label="([^"]*)" data-tooltip="([^"]*)"/.exec(html);
    if (found === null) return null;
    expect(found[2]).toBe(found[1]);
    return unattribute(found[1]!).split("\n");
  };
  /** How many times a text appears in the markup. */
  const count = (html: string, text: string): number => html.split(attribute(text)).length - 1;

  it("a completion without a full summary names the cause first on its mark, then what was done; short of room it also says what to correct", () => {
    const refusal = "400 prompt is too long: 140000 tokens > 131072 maximum";
    const truncated = "the response stopped at the output limit (finish_reason: length)";
    const unusable = "the response contained no usable summary";
    const keyRefused = "401 invalid x-api-key";
    const odd = "something nobody has words for";
    const rows = {
      refused: settled({ status: "completed", errorCode: "rejected", errorMessage: refusal }),
      truncated: settled({
        status: "completed",
        errorCode: "output_truncated",
        errorMessage: truncated,
      }),
      unusable: settled({ status: "completed", errorCode: "malformed", errorMessage: unusable }),
      keyRefused: settled({ status: "completed", errorCode: "auth", errorMessage: keyRefused }),
      odd: settled({ status: "completed", errorCode: "brand_new_code", errorMessage: odd }),
    };
    const lines = Object.fromEntries(
      Object.entries(rows).map(([name, html]) => [name, markLines(html)!]),
    ) as Record<keyof typeof rows, string[]>;
    const said = {
      refused: refusal,
      truncated,
      unusable,
      keyRefused,
      odd,
    } as const;
    for (const name of Object.keys(rows) as (keyof typeof rows)[]) {
      const html = rows[name];
      // Still a completion, titled as one.
      expect(html).toContain(dict.chat.compactionDone("summarize"));
      // The error's own words lead, on the first line, and nowhere else: not in a reason line
      // under the title, and not again further down the mark.
      expect(lines[name][0]!.endsWith(said[name])).toBe(true);
      expect(lines[name].slice(1).some((line) => line.includes(said[name]))).toBe(false);
      expect(count(html, said[name])).toBe(2);
      // Then what was done, the same whatever the cause.
      expect(lines[name][1]).toBe(lines.unusable[1]);
    }
    // The cause in words comes before them, with the HTTP status their words name.
    expect(lines.refused[0]!.length).toBeGreaterThan(refusal.length);
    expect(lines.refused[0]).toContain("HTTP 400");
    expect(lines.keyRefused[0]).toContain("HTTP 401");
    expect(lines.truncated[0]!.length).toBeGreaterThan(truncated.length);
    expect(lines.unusable[0]!.length).toBeGreaterThan(unusable.length);
    // A code with no words for it shows the error's words alone.
    expect(lines.odd[0]).toBe(odd);
    // Short of room — a refusal, or a summary cut off at the output limit — a third line says
    // what to correct; no other cause has one.
    expect(lines.refused).toHaveLength(3);
    expect(lines.truncated).toHaveLength(3);
    expect(lines.truncated[2]).toBe(lines.refused[2]);
    for (const name of ["unusable", "keyRefused", "odd"] as const) {
      expect(lines[name]).toHaveLength(2);
    }
    // A full summary's mark stays the plain settled glyph, with nothing to name.
    expect(markLines(settled({ status: "completed", summaryText: "[summary]x" }))).toBeNull();
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
