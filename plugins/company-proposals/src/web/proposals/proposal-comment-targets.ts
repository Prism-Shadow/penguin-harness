/**
 * Comments on targets — a scope entry, a test entry, a changed file, changed lines — as the page
 * finds them, kept apart from the markup so it runs without a DOM: which comments are on a
 * target, whether a comment on the diff is outdated, and which lines a click or a drag in the
 * diff names.
 */
import type {
  ProposalComment,
  ProposalCommentTarget,
  ProposalScopeKind,
} from "@prismshadow/penguin-server/api";

/** The commits the diff on screen was read at: what a comment on it is current against. */
export interface DiffCommits {
  headSha: string;
  baseSha: string;
}

/** The comments on a scope entry (by file and kind), in the order written. */
export function scopeComments(
  comments: readonly ProposalComment[],
  file: string,
  kind: ProposalScopeKind,
  revision: number,
): ProposalComment[] {
  return comments.filter(
    (c) =>
      c.target?.kind === "scope" &&
      c.target.file === file &&
      c.target.scopeKind === kind &&
      c.revision === revision,
  );
}

/** The comments on a test entry (by file). */
export function testComments(
  comments: readonly ProposalComment[],
  file: string,
  revision: number,
): ProposalComment[] {
  return comments.filter(
    (c) => c.target?.kind === "test" && c.target.file === file && c.revision === revision,
  );
}

/** The comments on a changed file: on the file, then on its lines by side and first line. */
export function fileComments(
  comments: readonly ProposalComment[],
  path: string,
): ProposalComment[] {
  const onFile = comments.filter((c) => c.target?.kind === "change-file" && c.target.path === path);
  const onLines = comments
    .filter((c) => c.target?.kind === "change-lines" && c.target.path === path)
    .sort((a, b) => {
      const x = a.target as Extract<ProposalCommentTarget, { kind: "change-lines" }>;
      const y = b.target as Extract<ProposalCommentTarget, { kind: "change-lines" }>;
      return x.side !== y.side ? (x.side === "old" ? -1 : 1) : x.start - y.start;
    });
  return [...onFile, ...onLines];
}

/**
 * Whether a comment on the diff was written at other commits than `current` (the branches moved
 * since); never for a comment that is not on the diff, nor while the current commits are unknown.
 */
export function isOutdated(comment: ProposalComment, current: DiffCommits | null): boolean {
  const t = comment.target;
  if (current === null || t === undefined) return false;
  if (t.kind !== "change-file" && t.kind !== "change-lines") return false;
  return t.headSha !== current.headSha || t.baseSha !== current.baseSha;
}

/** One end of a line selection: the line numbers its row holds, and the gutter clicked, if any. */
export interface LineEnd {
  old: number | null;
  new: number | null;
  /** A click on a line number names its side outright. */
  gutter?: "old" | "new";
}

/** A range of lines on one side, inclusive. */
export interface LineRange {
  side: "old" | "new";
  start: number;
  end: number;
}

/**
 * The lines between two ends, on one side: the side a gutter click named, else the new side when
 * both ends have a new line (context and added lines), else the old side when both have an old
 * one; null when the ends share no side (a removed line to an added one in the unified layout).
 */
export function lineRangeOf(a: LineEnd, b: LineEnd): LineRange | null {
  const named = a.gutter ?? b.gutter;
  const sides: Array<"old" | "new"> = named !== undefined ? [named] : ["new", "old"];
  for (const side of sides) {
    const x = a[side];
    const y = b[side];
    if (x === null || y === null) continue;
    return { side, start: Math.min(x, y), end: Math.max(x, y) };
  }
  return null;
}

/** The line ends an element of the diff stands on, read off the viewer's data attributes. */
export function lineEndOf(el: Element | null): LineEnd | null {
  const row = el?.closest("[data-old-line],[data-new-line]");
  if (row == null) return null;
  const read = (name: string): number | null => {
    const v = row.getAttribute(name);
    return v === null ? null : Number(v);
  };
  const gutter = el?.closest("[data-gutter]")?.getAttribute("data-gutter");
  return {
    old: read("data-old-line"),
    new: read("data-new-line"),
    ...(gutter === "old" || gutter === "new" ? { gutter } : {}),
  };
}
