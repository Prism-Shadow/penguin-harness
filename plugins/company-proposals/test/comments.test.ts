/**
 * Where a comment stands and how an agent reads it: a section's source and its paragraph
 * spans, a quote found again after the text moved (exactly, or with whitespace collapsed),
 * and the marked rendering — nested and overlapping ranges each keeping their own pair, in
 * document order, no offsets anywhere in what an agent sees.
 */
import { describe, expect, it } from "vitest";
import type { ProposalComment } from "@prismshadow/penguin-server/api";
import {
  locateQuote,
  markRanges,
  paragraphAtOffset,
  paragraphSpan,
  renderForAgent,
  sectionSource,
} from "../src/index.js";

const section = {
  id: "change",
  heading: "Change",
  paragraphs: [
    { id: "p1", text: "`notifyTicket` writes to the queue." },
    { id: "p2", text: "The digest is appended later." },
  ],
};

const comment = (over: Partial<ProposalComment>): ProposalComment => ({
  id: "c1-aaaa",
  sectionId: "change",
  range: { start: 0, end: 14 },
  quote: "`notifyTicket`",
  paragraphId: "p1",
  revision: 1,
  text: "Who calls it?",
  by: "user:boss",
  at: "2026-09-21T00:00:00Z",
  batchId: "b1",
  ...over,
});

describe("a section's source", () => {
  it("joins the paragraphs by a blank line, and spans and locates each paragraph in it", () => {
    const source = sectionSource(section);
    expect(source).toBe("`notifyTicket` writes to the queue.\n\nThe digest is appended later.");
    expect(paragraphSpan(section, "p2")).toEqual({ start: 37, end: 66 });
    expect(paragraphSpan(section, "p9")).toBeNull();
    expect(paragraphAtOffset(section, 0)).toBe("p1");
    expect(paragraphAtOffset(section, 35)).toBe("p1");
    expect(paragraphAtOffset(section, 40)).toBe("p2");
    expect(paragraphAtOffset(section, 999)).toBeNull();
  });
});

describe("locateQuote", () => {
  it("finds the exact quote first, then the same words with whitespace collapsed, else nothing", () => {
    expect(locateQuote("alpha beta\ngamma", "beta\ngamma")).toEqual({ start: 6, end: 16 });
    expect(locateQuote("alpha  beta\n  gamma", "beta gamma")).toEqual({ start: 7, end: 19 });
    expect(locateQuote("alpha", "zzz")).toBeNull();
    expect(locateQuote("alpha", "")).toBeNull();
  });
});

describe("markRanges", () => {
  it("wraps each range in its markers, nesting a contained range and pairing an overlapping one in document order", () => {
    const source = "abcdefghij";
    expect(
      markRanges(source, [
        { id: "outer", range: { start: 2, end: 8 } },
        { id: "inner", range: { start: 4, end: 6 } },
      ]),
    ).toBe("ab⟦outer⟧cd⟦inner⟧ef⟦/inner⟧gh⟦/outer⟧ij");
    expect(
      markRanges(source, [
        { id: "a", range: { start: 0, end: 5 } },
        { id: "b", range: { start: 3, end: 8 } },
      ]),
    ).toBe("⟦a⟧abc⟦b⟧de⟦/a⟧fgh⟦/b⟧ij");
    // A range past the end is clipped rather than lost.
    expect(markRanges("abc", [{ id: "x", range: { start: 1, end: 99 } }])).toBe("a⟦x⟧bc⟦/x⟧");
  });
});

describe("renderForAgent", () => {
  it("prints the sections with the passages marked, the comments by id, and the resolve command — never an offset", () => {
    const text = renderForAgent(
      { number: 7, revision: 1, sections: [section] },
      [
        comment({}),
        comment({
          id: "c2-bbbb",
          range: { start: 41, end: 47 },
          quote: "digest",
          paragraphId: "p2",
          text: "Which digest?",
          resolved: { by: "agent:dev", at: "2026-09-21T01:00:00Z", text: "Named it." },
        }),
        comment({
          id: "c3-cccc",
          revision: 0,
          quote: "an older passage",
          text: "Still open",
          batchId: null,
        }),
      ],
      { resolveCommand: (id) => `penguin org proposal resolve 7 ${id} -m "<what changed>"` },
    );
    expect(text).toContain("## Change\n\n⟦c1-aaaa⟧`notifyTicket`⟦/c1-aaaa⟧ writes to the queue.");
    expect(text).toContain("The ⟦c2-bbbb⟧digest⟦/c2-bbbb⟧ is appended later.");
    expect(text).toContain("⟦c1-aaaa⟧ user:boss (open): Who calls it?");
    expect(text).toContain("⟦c2-bbbb⟧ user:boss (resolved: Named it.): Which digest?");
    expect(text).toContain(
      '⟦c3-cccc⟧ user:boss (pending) (on revision 0: "an older passage"): Still open',
    );
    expect(text).toContain("Resolve each with: penguin org proposal resolve 7 <id>");
    expect(text).not.toMatch(/\b41\b|\b47\b/);
  });

  it("prints the sections alone when there are no comments", () => {
    const text = renderForAgent({ number: 1, revision: 1, sections: [section] }, []);
    expect(text).toBe(
      "## Change\n\n`notifyTicket` writes to the queue.\n\nThe digest is appended later.\n",
    );
  });
});
