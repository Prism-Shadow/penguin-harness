/**
 * features/proposals/proposals-model.ts unit tests: the queue's order (unread first, newest
 * next), what the action bar allows per status, the `proposal:<n>[#<pattern>]` reference
 * grammar and its hash form, how a pattern lands on a heading or a paragraph (first capture
 * group as the label, a broken pattern matching nothing), the comment ordering under a
 * paragraph, the comments whose paragraph a revision removed, the queue's filter, and the
 * event lines in both languages.
 */
import { describe, expect, it } from "vitest";
import type { ProposalComment, ProposalEvent, ProposalItem } from "@prismshadow/penguin-server/api";
import {
  diffLines,
  sectionDiffs,
  revisedAfterApproval,
  scopeFileCandidates,
  commentsInSection,
  eventDetail,
  eventLine,
  DEFAULT_PROPOSAL_QUERY,
  filterProposals,
  hasToken,
  parseProposalQuery,
  withToken,
  withoutToken,
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

describe("the queue's search grammar", () => {
  const item = (over: Partial<ProposalItem>): ProposalItem => ({
    number: 1,
    title: "Batch the desk notices",
    status: "ready",
    revision: 1,
    author: "acme_dev",
    implementer: null,
    delegatedBy: "user:alice",
    createdAt: "2026-09-21T00:00:00Z",
    updatedAt: "2026-09-21T00:00:00Z",
    unread: 0,
    pendingComments: 0,
    materials: [],
    ...over,
  });
  const items = [
    item({ number: 12, status: "drafting", unread: 2 }),
    item({
      number: 3,
      title: "Rename the runner",
      status: "merged",
      author: "acme_qa",
      implementer: "acme_dev",
      delegatedBy: "agent:acme_qa",
    }),
    item({ number: 7, status: "approved", implementer: "acme_dev" }),
    item({ number: 9, status: "rejected" }),
  ];
  const numbers = (q: string) => filterProposals(items, q).map((p) => p.number);

  it("parses key:value tokens, negation, quoted phrases and free text", () => {
    expect(parseProposalQuery('is:open -author:acme_qa "desk notices" rename')).toEqual({
      tokens: [
        { key: "is", value: "open", negated: false },
        { key: "author", value: "acme_qa", negated: true },
      ],
      text: ["desk notices", "rename"],
    });
    expect(parseProposalQuery("status:Merged").tokens).toEqual([
      { key: "is", value: "merged", negated: false },
    ]);
    // An unknown key is just text; a bare dash is text too.
    expect(parseProposalQuery("foo:bar -").text).toEqual(["foo:bar", "-"]);
  });

  it("hides the closed half by default and opens it a state at a time", () => {
    expect(numbers(DEFAULT_PROPOSAL_QUERY)).toEqual([12, 7]);
    expect(numbers("is:closed")).toEqual([3, 9]);
    expect(numbers("is:merged")).toEqual([3]);
    expect(numbers("is:ready is:approved")).toEqual([7]);
    expect(numbers("")).toEqual([12, 3, 7, 9]);
    expect(numbers("-is:merged -is:rejected")).toEqual([12, 7]);
  });

  it("filters by author, implementer, delegator, unread and no:implementer, ANDed across keys", () => {
    expect(numbers("author:acme_qa")).toEqual([3]);
    expect(numbers("implementer:acme_dev")).toEqual([3, 7]);
    expect(numbers("implementer:acme_dev is:open")).toEqual([7]);
    expect(numbers("by:alice")).toEqual([12, 7, 9]);
    expect(numbers("by:agent:acme_qa")).toEqual([3]);
    expect(numbers("unread:yes")).toEqual([12]);
    expect(numbers("unread:no is:open")).toEqual([7]);
    expect(numbers("no:implementer")).toEqual([12, 9]);
  });

  it("matches free text against the number and the title, case-insensitively", () => {
    expect(numbers("#12")).toEqual([12]);
    expect(numbers("RENAME")).toEqual([3]);
    expect(numbers('"desk notices" is:open')).toEqual([12, 7]);
    expect(numbers("nothing")).toEqual([]);
  });

  it("edits tokens for the chips without touching the rest of the query", () => {
    expect(hasToken("is:open author:x", "is", "open")).toBe(true);
    expect(hasToken("-is:open", "is", "open")).toBe(false);
    expect(hasToken("author:x", "is")).toBe(false);
    expect(withoutToken("is:open is:ready author:x rename", "is")).toBe("author:x rename");
    expect(withoutToken("is:open is:ready", "is", "ready")).toBe("is:open");
    expect(withToken("author:x", "is", "merged")).toBe("author:x is:merged");
    expect(withToken("is:open is:ready author:x", "is", "merged", { replace: true })).toBe(
      "author:x is:merged",
    );
    expect(withToken("is:open", "is", "open")).toBe("is:open");
    expect(withoutToken('unread:yes "two words"', "unread")).toBe('"two words"');
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

describe("scopeFileCandidates", () => {
  it("offers the file as written and the file under the shared workspace, inside the session's Workspace", () => {
    expect(scopeFileCandidates("packages/a.ts", "/w/shared", "/w/shared")).toEqual([
      "packages/a.ts",
    ]);
    expect(scopeFileCandidates("packages/a.ts", "/w/shared/dev", "/w/shared")).toEqual([
      "packages/a.ts",
    ]);
    expect(scopeFileCandidates("packages/a.ts", "/w/shared", "/w/shared/dev")).toEqual([
      "packages/a.ts",
      "dev/packages/a.ts",
    ]);
    expect(scopeFileCandidates("../x.ts", "/w/shared", null)).toEqual([]);
  });
});

describe("the diff since the approved revision", () => {
  it("diffs lines by their longest common subsequence", () => {
    expect(diffLines("a\nb\nc", "a\nx\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "x" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
    expect(diffLines("", "one")).toEqual([{ kind: "add", text: "one" }]);
    expect(diffLines("one", "")).toEqual([{ kind: "del", text: "one" }]);
    expect(diffLines("same", "same")).toEqual([{ kind: "same", text: "same" }]);
  });

  it("matches sections by heading: unchanged, changed, added and removed", () => {
    const section = (id: string, heading: string, text: string) => ({
      id,
      heading,
      paragraphs: [{ id: `${id}p`, text }],
    });
    const before = [
      section("a", "Change", "old"),
      section("b", "Purpose", "why"),
      section("c", "Test", "t"),
    ];
    const after = [
      section("a", "Change", "new"),
      section("b", "Purpose", "why"),
      section("d", "Risks", "r"),
    ];
    expect(sectionDiffs(before, after).map((d) => [d.heading, d.kind])).toEqual([
      ["Change", "changed"],
      ["Purpose", "same"],
      ["Risks", "added"],
      ["Test", "removed"],
    ]);
    expect(sectionDiffs(before, after)[0]!.lines).toEqual([
      { kind: "del", text: "old" },
      { kind: "add", text: "new" },
    ]);
  });

  it("has a diff to show only while an older approval stands and the proposal is open again", () => {
    expect(revisedAfterApproval({ status: "ready", revision: 3, approvedRevision: 1 })).toBe(true);
    expect(revisedAfterApproval({ status: "drafting", revision: 2, approvedRevision: 1 })).toBe(
      true,
    );
    expect(revisedAfterApproval({ status: "approved", revision: 2, approvedRevision: 2 })).toBe(
      false,
    );
    expect(revisedAfterApproval({ status: "ready", revision: 2, approvedRevision: null })).toBe(
      false,
    );
    expect(revisedAfterApproval({ status: "merged", revision: 3, approvedRevision: 1 })).toBe(
      false,
    );
  });
});
