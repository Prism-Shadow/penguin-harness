/**
 * What a comment is on when it is not a passage of a section: a scope entry, a test entry, a file
 * of the impl branch's diff, or a range of lines of one (see `ProposalCommentTarget`).
 *
 * A target is checked against what stands when the comment is written: a scope entry by its file
 * and kind and a test entry by its file in the current revision, a diff target against the diff
 * read now — the commits the page read it at must still be the head and base, the file must be in
 * it, and every line of a range must be one the diff shows on that side. The comment keeps what it
 * was written on as its `quote` (a line range: the lines themselves), so a comment on the diff
 * that the branches have since moved past still shows what it was about.
 *
 * Nothing here reads the store or the network: the service hands in the proposal and a way to
 * read the diff.
 */
import type {
  ProposalCommentTarget,
  ProposalImplChangedFile,
  ProposalImplChanges,
  ProposalScopeEntry,
  ProposalScopeKind,
  ProposalTestEntry,
} from "@prismshadow/penguin-server/api";
import { ProposalError } from "./domain.js";

/** The most lines one comment may cover: its quote is stored with it. */
export const MAX_TARGET_LINES = 400;

const SCOPE_KINDS: readonly ProposalScopeKind[] = ["edit", "new", "delete", "rename"];
/** A full commit id: SHA-1 or SHA-256. */
const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_PATH = 1000;

const refuse = (message: string): ProposalError =>
  new ProposalError(400, "comment_target", message);

/** The keys each kind takes, besides `kind`: anything else is refused. */
const KEYS: Record<ProposalCommentTarget["kind"], readonly string[]> = {
  scope: ["file", "scopeKind"],
  test: ["file"],
  "change-file": ["path", "headSha", "baseSha"],
  "change-lines": ["path", "side", "start", "end", "headSha", "baseSha"],
};

/** The `target` param of `proposal.comment`, checked field by field; a 400 says which is wrong. */
export function targetParam(value: unknown): ProposalCommentTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw refuse("target must be an object.");
  }
  const v = value as Record<string, unknown>;
  const kind = v.kind;
  if (typeof kind !== "string" || !(kind in KEYS)) {
    throw refuse(`target.kind must be one of ${Object.keys(KEYS).join(", ")}.`);
  }
  const keys: readonly string[] = KEYS[kind as ProposalCommentTarget["kind"]];
  for (const key of Object.keys(v)) {
    if (key !== "kind" && !keys.includes(key)) {
      throw refuse(`target.${key} is not a field of a ${kind} target.`);
    }
  }
  const path = (name: string): string => {
    const p = v[name];
    if (typeof p !== "string" || p.trim() === "" || p.length > MAX_PATH || p.includes("\0")) {
      throw refuse(`target.${name} must be a non-empty path of at most ${MAX_PATH} characters.`);
    }
    return p;
  };
  const commit = (name: string): string => {
    const c = v[name];
    if (typeof c !== "string" || !COMMIT.test(c)) {
      throw refuse(`target.${name} must be a full commit id.`);
    }
    return c;
  };
  const line = (name: string): number => {
    const n = v[name];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1) {
      throw refuse(`target.${name} must be a line number (an integer from 1).`);
    }
    return n;
  };
  switch (kind) {
    case "scope": {
      const scopeKind = v.scopeKind as ProposalScopeKind;
      if (!SCOPE_KINDS.includes(scopeKind)) {
        throw refuse(`target.scopeKind must be one of ${SCOPE_KINDS.join(", ")}.`);
      }
      return { kind, file: path("file"), scopeKind };
    }
    case "test":
      return { kind, file: path("file") };
    case "change-file":
      return { kind, path: path("path"), headSha: commit("headSha"), baseSha: commit("baseSha") };
    default: {
      if (v.side !== "old" && v.side !== "new") throw refuse("target.side must be old or new.");
      const start = line("start");
      const end = line("end");
      if (end < start) throw refuse("target.end must not be before target.start.");
      if (end - start + 1 > MAX_TARGET_LINES) {
        throw refuse(`A comment covers at most ${MAX_TARGET_LINES} lines.`);
      }
      return {
        kind: "change-lines",
        path: path("path"),
        side: v.side,
        start,
        end,
        headSha: commit("headSha"),
        baseSha: commit("baseSha"),
      };
    }
  }
}

/** Whether a scope or test target is in a revision; a diff target is not the revision's to judge. */
export function targetKept(
  t: ProposalCommentTarget,
  r: { scope: readonly ProposalScopeEntry[]; tests: readonly ProposalTestEntry[] },
): boolean {
  if (t.kind === "scope") return r.scope.some((e) => e.file === t.file && e.kind === t.scopeKind);
  if (t.kind === "test") return r.tests.some((e) => e.file === t.file);
  return true;
}

/** Refuses a scope or test target the revision does not list. */
export function checkDocTarget(
  t: ProposalCommentTarget,
  p: {
    number: number;
    revision: number;
    scope: readonly ProposalScopeEntry[];
    tests: readonly ProposalTestEntry[];
  },
): void {
  if (targetKept(t, p)) return;
  if (t.kind === "scope") {
    throw refuse(
      `Revision ${p.revision} of proposal #${p.number} has no ${t.scopeKind} scope entry for ${t.file}; reload the proposal.`,
    );
  }
  if (t.kind === "test") {
    throw refuse(
      `Revision ${p.revision} of proposal #${p.number} lists no test in ${t.file}; reload the proposal.`,
    );
  }
}

/**
 * The text a diff target is written on — the path, or the lines of the range — checked against
 * the diff as it reads now: `changes(false)` first, and for a line range the diff with whitespace
 * ignored as well, since the page may have shown that one (its line numbers are the file's, but
 * its hunks show other lines).
 */
export async function diffTargetQuote(
  t: Extract<ProposalCommentTarget, { kind: "change-file" | "change-lines" }>,
  changes: (ignoreWhitespace: boolean) => Promise<ProposalImplChanges>,
): Promise<string> {
  const plain = await changes(false);
  if (plain.headSha !== t.headSha || plain.baseSha !== t.baseSha) {
    throw refuse(
      `The impl branch moved since the diff was read (head ${plain.headSha.slice(0, 7)}, base ${plain.baseSha.slice(0, 7)} now); reload the diff and comment again.`,
    );
  }
  const fileOf = (c: ProposalImplChanges) => c.files.find((f) => f.path === t.path) ?? null;
  const file = fileOf(plain);
  if (file === null) throw refuse(`The impl branch's diff does not change ${t.path}.`);
  if (t.kind === "change-file") return t.path;
  let lines = linesOf(file, t.side, t.start, t.end);
  if (lines === null) {
    const spaced = fileOf(await changes(true));
    lines = spaced === null ? null : linesOf(spaced, t.side, t.start, t.end);
  }
  if (lines === null) {
    throw refuse(
      `Lines ${t.start}–${t.end} on the ${t.side} side of ${t.path} are not all in the diff; comment on lines it shows, or on the file.`,
    );
  }
  return lines.join("\n");
}

/**
 * The text of lines `start`..`end` on one side of a file's hunks, or null when any of them is not
 * shown there: the old side holds the context and deleted lines, the new side the context and
 * added ones.
 */
export function linesOf(
  file: Pick<ProposalImplChangedFile, "hunks">,
  side: "old" | "new",
  start: number,
  end: number,
): string[] | null {
  const shown = new Map<number, string>();
  for (const h of file.hunks) {
    let oldNo = h.oldStart;
    let newNo = h.newStart;
    for (const l of h.lines) {
      if (l.kind !== "add") {
        if (side === "old") shown.set(oldNo, l.text);
        oldNo += 1;
      }
      if (l.kind !== "del") {
        if (side === "new") shown.set(newNo, l.text);
        newNo += 1;
      }
    }
  }
  const out: string[] = [];
  for (let n = start; n <= end; n++) {
    const text = shown.get(n);
    if (text === undefined) return null;
    out.push(text);
  }
  return out;
}

/** A target as its columns, in the order store-write.ts's INSERT names them; all null for a passage. */
export function targetColumns(t: ProposalCommentTarget | undefined): Array<string | number | null> {
  if (t === undefined) return [null, null, null, null, null, null, null, null];
  switch (t.kind) {
    case "scope":
      return [t.kind, t.file, t.scopeKind, null, null, null, null, null];
    case "test":
      return [t.kind, t.file, null, null, null, null, null, null];
    case "change-file":
      return [t.kind, t.path, null, null, null, null, t.headSha, t.baseSha];
    case "change-lines":
      return [t.kind, t.path, null, t.side, t.start, t.end, t.headSha, t.baseSha];
  }
}

/** A target in words, for an agent: `scope edit src/a.ts`, `lines 3–5 (new) of src/a.ts at 1a2b3c4`. */
export function describeTarget(t: ProposalCommentTarget): string {
  switch (t.kind) {
    case "scope":
      return `scope ${t.scopeKind} ${t.file}`;
    case "test":
      return `tests ${t.file}`;
    case "change-file":
      return `changed file ${t.path} at ${t.headSha.slice(0, 7)}`;
    case "change-lines":
      return `${t.start === t.end ? `line ${t.start}` : `lines ${t.start}–${t.end}`} (${t.side}) of ${t.path} at ${t.headSha.slice(0, 7)}`;
  }
}
