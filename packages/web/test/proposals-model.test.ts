/**
 * features/proposals/proposals-model.ts unit tests: the queue's order (unread first, newest
 * next), what the action bar allows per status, the `proposal:<n>[#<pattern>]` reference
 * grammar and its hash form, how a pattern lands on a heading or a paragraph (first capture
 * group as the label, a broken pattern matching nothing), the comment ordering under a
 * paragraph, the comments whose paragraph a revision removed, the queue's filter, and the
 * event lines in both languages.
 */
import { describe, expect, it } from "vitest";
import type { ProposalComment, ProposalEvent } from "@prismshadow/penguin-server/api";
import {
  commentsInSection,
  eventDetail,
  eventLine,
  filterProposals,
  matchProposalPattern,
  orphanComments,
  paragraphSpan,
  parseProposalHash,
  parseProposalRef,
  projectMarkdown,
  proposalActions,
  proposalHashFor,
  proposalRefText,
  proposalsRoute,
  rangeOfSelection,
  sectionSource,
  sortProposals,
  trimPatternPunctuation,
} from "../src/features/proposals/proposals-model";
import { setActiveStrings, zh } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

describe("sortProposals", () => {
  it("puts the ones with unread events first, newest first within each half", () => {
    const sorted = sortProposals([
      { number: 3, unread: 0 },
      { number: 1, unread: 2 },
      { number: 5, unread: 0 },
      { number: 2, unread: 1 },
    ]);
    expect(sorted.map((p) => p.number)).toEqual([2, 1, 5, 3]);
  });
});

describe("proposalActions", () => {
  it("offers approval only when ready, changes only with pending comments, and nothing on a closed one", () => {
    expect(proposalActions("ready", 2)).toEqual({
      requestChanges: true,
      approve: true,
      reject: true,
      markMerged: false,
    });
    expect(proposalActions("drafting", 0)).toEqual({
      requestChanges: false,
      approve: false,
      reject: true,
      markMerged: false,
    });
    expect(proposalActions("approved", 1)).toEqual({
      requestChanges: true,
      approve: false,
      reject: true,
      markMerged: true,
    });
    expect(proposalActions("merged", 3)).toEqual({
      requestChanges: false,
      approve: false,
      reject: false,
      markMerged: false,
    });
    expect(proposalActions("rejected", 3).reject).toBe(false);
  });
});

describe("the proposal reference grammar", () => {
  it("parses a bare number, a number with a pattern, and nothing else", () => {
    expect(parseProposalRef("proposal:12")).toEqual({ number: 12 });
    expect(parseProposalRef("proposal:12#Rename (\\w+)")).toEqual({
      number: 12,
      pattern: "Rename (\\w+)",
    });
    expect(parseProposalRef(" proposal:7 ")).toEqual({ number: 7 });
    expect(parseProposalRef("proposal:0")).toBeNull();
    expect(parseProposalRef("proposal:")).toBeNull();
    expect(parseProposalRef("ticket:12")).toBeNull();
    expect(parseProposalRef("see proposal:12")).toBeNull();
  });

  it("gives a trailing sentence mark back to the sentence, and round-trips the canonical text", () => {
    expect(trimPatternPunctuation("Rename.")).toBe("Rename");
    expect(trimPatternPunctuation("a.b")).toBe("a.b");
    expect(parseProposalRef("proposal:12#Rename,")).toEqual({ number: 12, pattern: "Rename" });
    expect(proposalRefText({ number: 12 })).toBe("proposal:12");
    expect(proposalRefText({ number: 12, pattern: "x" })).toBe("proposal:12#x");
  });

  it("carries the pattern in the hash as `p=`, and reads a plain id back as a target", () => {
    expect(proposalHashFor({ number: 3 })).toBe("");
    expect(proposalHashFor({ number: 3, pattern: "a b" })).toBe("#p=a%20b");
    expect(parseProposalHash("#p=a%20b")).toEqual({ pattern: "a b" });
    expect(parseProposalHash("#p3")).toEqual({ targetId: "p3" });
    expect(parseProposalHash("")).toBeNull();
    expect(parseProposalHash("#p=")).toBeNull();
    expect(parseProposalHash("#p=%E0%A4%A")).toBeNull();
  });
});

const sections = [
  {
    id: "s1",
    heading: "Change",
    paragraphs: [{ id: "p1", text: "Rename OrgTaskRunner.startTask\nto run" }],
  },
  { id: "s2", heading: "Test", paragraphs: [{ id: "p2", text: "reconcile.test.ts covers it" }] },
];

describe("matchProposalPattern", () => {
  it("lands on the first heading that matches, before any paragraph", () => {
    expect(matchProposalPattern({ sections }, "Test")).toEqual({ targetId: "s2", label: "Test" });
  });

  it("falls through to a paragraph's first line and labels the hit by the first capture group", () => {
    expect(matchProposalPattern({ sections }, "Rename (\\S+)")).toEqual({
      targetId: "p1",
      label: "OrgTaskRunner.startTask",
    });
    expect(matchProposalPattern({ sections }, "to run")).toBeNull();
  });

  it("treats a pattern that is not a regular expression as matching nothing", () => {
    expect(matchProposalPattern({ sections }, "(")).toBeNull();
  });
});

const comment = (over: Partial<ProposalComment>): ProposalComment => ({
  id: "c",
  sectionId: "s1",
  range: { start: 0, end: 5 },
  quote: "Alpha",
  paragraphId: "p1",
  revision: 1,
  text: "t",
  by: "user:alice",
  at: "2026-09-21T00:00:00Z",
  batchId: null,
  ...over,
});

describe("a section's source and its paragraphs", () => {
  const section = {
    paragraphs: [
      { id: "p1", text: "Alpha one" },
      { id: "p2", text: "Beta two" },
    ],
  };
  it("joins the paragraphs by a blank line and spans each paragraph in it", () => {
    expect(sectionSource(section)).toBe("Alpha one\n\nBeta two");
    expect(paragraphSpan(section, "p2")).toEqual({ start: 11, end: 19 });
    expect(paragraphSpan(section, "p9")).toBeNull();
  });
});

describe("projectMarkdown", () => {
  it("drops the syntax the reader never sees and maps every kept character to its source offset", () => {
    const source = "## Change\n\n`notifyTicket` **writes** to [the queue](proposals.md).";
    const { plain, map } = projectMarkdown(source);
    expect(plain).toBe("Change\n\nnotifyTicket writes to the queue.");
    // `n` of notifyTicket sits after the opening backtick in the source.
    expect(source[map[plain.indexOf("notifyTicket")]!]).toBe("n");
    expect(source.slice(map[plain.indexOf("queue")]!, map[plain.indexOf("queue")]! + 5)).toBe(
      "queue",
    );
  });

  it("skips a fence line and a list marker but keeps the text", () => {
    const { plain } = projectMarkdown("- first\n\n```ts\nconst a = 1;\n```");
    expect(plain).toBe("first\n\nconst a = 1;\n");
  });
});

describe("rangeOfSelection", () => {
  const source =
    "`notifyTicket` writes the change to `org_desk_notices`;\nthe queue is taken later.";
  it("places rendered words in the source, across the syntax the rendering dropped", () => {
    const range = rangeOfSelection(source, "notifyTicket writes the change");
    expect(range).not.toBeNull();
    expect(source.slice(range!.start, range!.end)).toBe("`notifyTicket` writes the change");
  });

  it("ignores the whitespace differences a rendered selection carries", () => {
    const range = rangeOfSelection(source, "org_desk_notices;   the queue");
    expect(source.slice(range!.start, range!.end)).toBe("`org_desk_notices`;\nthe queue");
  });

  it("falls back to the paragraph the selection began in, else to nothing", () => {
    const section = {
      paragraphs: [
        { id: "p1", text: "Alpha" },
        { id: "p2", text: "Beta" },
      ],
    };
    expect(rangeOfSelection("Alpha\n\nBeta", "zzz", { section, paragraphId: "p2" })).toEqual({
      start: 7,
      end: 11,
    });
    expect(rangeOfSelection("Alpha", "zzz")).toBeNull();
  });
});

describe("comments in a section", () => {
  it("lists a section's comments of the current revision by position", () => {
    const list = commentsInSection(
      [
        comment({ id: "a", range: { start: 20, end: 25 } }),
        comment({ id: "b", range: { start: 2, end: 9 } }),
        comment({ id: "c", sectionId: "s2" }),
        comment({ id: "d", revision: 0 }),
      ],
      "s1",
      1,
    );
    expect(list.map((c) => c.id)).toEqual(["b", "a"]);
  });

  it("names the comments whose passage the current revision no longer has", () => {
    const gone = orphanComments([comment({ id: "a" }), comment({ id: "b", revision: 0 })], 1);
    expect(gone.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("proposalsRoute", () => {
  it("shows the queue without a number, and one proposal with a positive integer", () => {
    expect(proposalsRoute(undefined)).toEqual({ queue: true });
    expect(proposalsRoute("12")).toEqual({ number: 12 });
    expect(proposalsRoute("0")).toEqual({ queue: true });
    expect(proposalsRoute("x")).toEqual({ queue: true });
  });
});

describe("filterProposals", () => {
  const items = [
    { number: 12, title: "Batch the desk notices", unread: 0 },
    { number: 3, title: "Rename the runner", unread: 1 },
  ];
  it("matches the number or the title, case-insensitively, and returns everything for a blank query", () => {
    const filter = (q: string) => filterProposals(items as never, q).map((p) => p.number);
    expect(filter("")).toEqual([12, 3]);
    expect(filter("#12")).toEqual([12]);
    expect(filter("3")).toEqual([3]);
    expect(filter("RENAME")).toEqual([3]);
    expect(filter("nothing")).toEqual([]);
  });
});

describe("eventLine", () => {
  const ev = (over: Partial<ProposalEvent>): ProposalEvent => ({
    seq: 1,
    at: "2026-09-21T00:00:00Z",
    kind: "created",
    by: "user:alice",
    ...over,
  });
  const names = new Map([["acme_impl", "Impl"]]);

  it("says what happened in the interface's language, naming an employee by its name", () => {
    setActiveStrings(en);
    expect(eventLine(ev({ kind: "revised", revision: 2 }), names)).toBe("published revision 2");
    expect(eventLine(ev({ kind: "implementation_started", text: "acme_impl" }), names)).toBe(
      "asked Impl to implement it",
    );
    expect(eventLine(ev({ kind: "changes_requested", text: "3" }), names)).toBe(
      "requested changes (3 comments)",
    );
    setActiveStrings(zh);
    expect(eventLine(ev({ kind: "approved" }), names)).toBe("认可并请求合并");
  });

  it("keeps prose under the line only for feedback, resolutions and rejections", () => {
    expect(eventDetail(ev({ kind: "feedback", text: "scope grew" }))).toBe("scope grew");
    expect(eventDetail(ev({ kind: "rejected", text: "not now" }))).toBe("not now");
    expect(eventDetail(ev({ kind: "material_added", text: "PR #5" }))).toBeNull();
    expect(eventDetail(ev({ kind: "feedback" }))).toBeNull();
  });
});
