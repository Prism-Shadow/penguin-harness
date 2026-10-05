/**
 * Comments on targets on the proposal page, via react-dom/server static markup (node env, no
 * DOM): a "comment" button and the count beside every scope and test entry (none on a removed
 * one, none outside the page's comments provider, none on a closed proposal), which comments are
 * on which target, an outdated diff comment marked as such with its lines to unfold, a comment
 * listed away from its target naming it, and the lines a click, a Shift-click or a drag names.
 */
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type {
  ProposalComment,
  ProposalCommentTarget,
  ProposalScopeEntry,
  ProposalTestEntry,
} from "@prismshadow/penguin-server/api";
import { ScopeRow, TestRow } from "../src/features/proposals/proposals-page";
import { CommentLine, targetLabel } from "../src/features/proposals/proposal-comment-line";
import {
  fileComments,
  isOutdated,
  lineRangeOf,
  scopeComments,
  testComments,
} from "../src/features/proposals/proposal-comment-targets";
import {
  ProposalCommentsProvider,
  type ProposalCommentsValue,
} from "../src/features/proposals/proposal-target-comments";
import { S } from "../src/lib/strings";
import { toneInk } from "../src/lib/tone";

const A = "a".repeat(40);
const B = "b".repeat(40);
const D = "d".repeat(40);

const comment = (
  id: string,
  target: ProposalCommentTarget | undefined,
  over: Partial<ProposalComment> = {},
): ProposalComment => ({
  id,
  ...(target !== undefined ? { target } : {}),
  sectionId: target === undefined ? "change" : "",
  range: { start: 0, end: 0 },
  quote: target?.kind === "change-lines" ? "new\nmore" : "",
  revision: 2,
  text: `on ${id}`,
  by: "user:boss",
  at: "2026-10-05T00:00:00Z",
  batchId: "b1",
  ...over,
});

const SCOPE: ProposalScopeEntry = { kind: "edit", file: "src/notices.ts", state: "exists" };
const TEST: ProposalTestEntry = {
  kind: "new",
  file: "test/notices.test.ts",
  group: "unit",
  description: "one line per sweep",
};
const LINES: ProposalCommentTarget = {
  kind: "change-lines",
  path: "src/notices.ts",
  side: "new",
  start: 2,
  end: 3,
  headSha: A,
  baseSha: B,
};
const COMMENTS: ProposalComment[] = [
  comment("c1", { kind: "scope", file: "src/notices.ts", scopeKind: "edit" }),
  comment("c2", { kind: "scope", file: "src/notices.ts", scopeKind: "delete" }),
  comment("c3", { kind: "test", file: "test/notices.test.ts" }, { batchId: null }),
  comment("c4", { kind: "change-file", path: "src/notices.ts", headSha: A, baseSha: B }),
  comment("c5", LINES),
  comment("c6", { ...LINES, side: "old", start: 1, end: 1 }),
  comment("c7", undefined),
  comment("c8", { kind: "test", file: "test/notices.test.ts" }, { revision: 1 }),
];

const value = (over: Partial<ProposalCommentsValue> = {}): ProposalCommentsValue => ({
  comments: COMMENTS,
  revision: 2,
  names: new Map(),
  locale: "en",
  me: "user:boss",
  busy: false,
  closed: false,
  current: { headSha: A, baseSha: B },
  onTarget: async () => true,
  onEdit: async () => true,
  onDelete: async () => true,
  ...over,
});

const html = (node: ReactNode, ctx: ProposalCommentsValue | null = value()) =>
  renderToStaticMarkup(
    ctx === null
      ? createElement("ul", null, node)
      : createElement(ProposalCommentsProvider, {
          value: ctx,
          children: createElement("ul", null, node),
        }),
  );
const scopeRow = (change: "same" | "removed" = "same") =>
  createElement(ScopeRow, {
    row: { change, entry: SCOPE },
    root: "",
    onOpenFile: () => {},
  });
const testRow = (change: "same" | "removed" = "same") =>
  createElement(TestRow, { row: { change, entry: TEST }, root: "", onOpenFile: () => {} });
const escape = (s: string) => s.replaceAll('"', "&quot;");

describe("which comments are on which target", () => {
  it("finds a scope entry's by file and kind, a test entry's by file, on the current revision", () => {
    expect(scopeComments(COMMENTS, "src/notices.ts", "edit", 2).map((c) => c.id)).toEqual(["c1"]);
    expect(scopeComments(COMMENTS, "src/notices.ts", "delete", 2).map((c) => c.id)).toEqual(["c2"]);
    expect(testComments(COMMENTS, "test/notices.test.ts", 2).map((c) => c.id)).toEqual(["c3"]);
  });

  it("lists a changed file's comments: on the file, then on its lines, old side first", () => {
    expect(fileComments(COMMENTS, "src/notices.ts").map((c) => c.id)).toEqual(["c4", "c6", "c5"]);
    expect(fileComments(COMMENTS, "src/other.ts")).toEqual([]);
  });

  it("marks a diff comment outdated once either commit moved, and nothing else", () => {
    const lines = COMMENTS[4]!;
    expect(isOutdated(lines, { headSha: A, baseSha: B })).toBe(false);
    expect(isOutdated(lines, { headSha: D, baseSha: B })).toBe(true);
    expect(isOutdated(lines, { headSha: A, baseSha: D })).toBe(true);
    expect(isOutdated(lines, null)).toBe(false);
    expect(isOutdated(COMMENTS[0]!, { headSha: D, baseSha: D })).toBe(false);
    expect(isOutdated(COMMENTS[6]!, { headSha: D, baseSha: D })).toBe(false);
  });
});

describe("the lines a selection names", () => {
  it("takes the gutter's side on a click, and the range between a click and a Shift-click", () => {
    expect(
      lineRangeOf({ old: 3, new: 4, gutter: "old" }, { old: 3, new: 4, gutter: "old" }),
    ).toEqual({ side: "old", start: 3, end: 3 });
    expect(lineRangeOf({ old: null, new: 9, gutter: "new" }, { old: null, new: 4 })).toEqual({
      side: "new",
      start: 4,
      end: 9,
    });
  });

  it("reads a drag on the new side when both ends have a new line, else the old side, else nothing", () => {
    expect(lineRangeOf({ old: 2, new: 2 }, { old: null, new: 5 })).toEqual({
      side: "new",
      start: 2,
      end: 5,
    });
    expect(lineRangeOf({ old: 2, new: null }, { old: 4, new: 6 })).toEqual({
      side: "old",
      start: 2,
      end: 4,
    });
    // A removed line to an added one (unified): no side holds both.
    expect(lineRangeOf({ old: 2, new: null }, { old: null, new: 2 })).toBeNull();
  });
});

describe("comment controls beside scope and test entries", () => {
  const t = S.company.proposals.targets;

  it("puts a comment button and the count on a scope entry, and on a test entry", () => {
    const scope = html(scopeRow());
    expect(scope).toContain(`aria-label="${escape(t.commentScope)}"`);
    expect(scope).toContain(`>${t.count(1)}</button>`);
    const test = html(testRow());
    expect(test).toContain(`aria-label="${escape(t.commentTest)}"`);
    expect(test).toContain(`>${t.count(1)}</button>`);
    // A pending comment's count is in the attention ink.
    expect(test).toContain(`tabular-nums ${toneInk.attention}">${t.count(1)}</button>`);
  });

  it("offers none on a removed entry, outside the page, or on a closed proposal", () => {
    expect(html(scopeRow("removed"))).not.toContain(t.commentScope);
    expect(html(testRow("removed"))).not.toContain(t.commentTest);
    expect(html(scopeRow(), null)).not.toContain(t.commentScope);
    const closed = html(scopeRow(), value({ closed: true }));
    expect(closed).not.toContain(`aria-label="${escape(t.commentScope)}"`);
    // Its comments still show.
    expect(closed).toContain(`>${t.count(1)}</button>`);
  });
});

describe("a targeted comment as it is drawn", () => {
  const t = S.company.proposals.targets;
  const line = (c: ProposalComment, over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(
      createElement(CommentLine, { comment: c, names: new Map(), locale: "en", ...over }),
    );

  it("marks an outdated line comment and offers the lines it was written on", () => {
    const outdated = line(COMMENTS[4]!, { outdated: true });
    expect(outdated).toContain(`>${t.outdated}</span>`);
    expect(outdated).toContain(`data-tooltip="${escape(t.outdatedHint)}"`);
    expect(outdated).toContain(`aria-expanded="false"`);
    expect(outdated).toContain(t.showLines);
    expect(outdated).toContain(escape(targetLabel(LINES)));
    const current = line(COMMENTS[4]!);
    expect(current).not.toContain(t.outdated);
    expect(current).not.toContain(t.showLines);
  });

  it("names its target when listed away from it, on the revision it was last on", () => {
    const stale = line(COMMENTS[7]!, { stale: true, showTarget: true });
    expect(stale).toContain(escape(t.onTest("test/notices.test.ts")));
    expect(stale).toContain(t.onRevision(1));
    expect(targetLabel(COMMENTS[0]!.target!)).toBe(
      t.onScope(S.company.proposals.scopeKind.edit, "src/notices.ts"),
    );
    expect(targetLabel(LINES)).toBe(`${t.lines("new", 2, 3)} · src/notices.ts`);
  });
});
