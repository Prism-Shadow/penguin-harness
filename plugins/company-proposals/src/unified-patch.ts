/**
 * Unified-diff text into hunks, for both readers of an impl branch's diff: one file's hunks as
 * GitHub's comparison sends them (`@@ … @@` onwards, no file header), and `git diff`'s output
 * for many files, split at each `diff --git` header. Pure: no git, no I/O.
 */
import type { ProposalImplDiffLine, ProposalImplHunk } from "@prismshadow/penguin-server/api";

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** The hunks of one file's patch text; lines outside a hunk (headers, `\ No newline…`) are skipped. */
export function parseHunks(text: string): ProposalImplHunk[] {
  const hunks: ProposalImplHunk[] = [];
  let current: ProposalImplHunk | null = null;
  for (const line of splitLines(text)) {
    const header = HUNK_HEADER.exec(line);
    if (header !== null) {
      current = {
        oldStart: Number(header[1]),
        oldLines: header[2] === undefined ? 1 : Number(header[2]),
        newStart: Number(header[3]),
        newLines: header[4] === undefined ? 1 : Number(header[4]),
        section: header[5] ?? "",
        lines: [],
      };
      hunks.push(current);
      continue;
    }
    if (current === null) continue;
    const kind = lineKind(line[0]);
    if (kind !== null) current.lines.push({ kind, text: line.slice(1) });
  }
  return hunks;
}

function lineKind(mark: string | undefined): ProposalImplDiffLine["kind"] | null {
  if (mark === "+") return "add";
  if (mark === "-") return "del";
  if (mark === " ") return "context";
  return null;
}

/** Lines without their terminators; a trailing newline makes no empty last line. */
function splitLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines.map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
}

/** One file's section of `git diff` output: its `diff --git` line and the text after it. */
export interface PatchSection {
  header: string;
  body: string;
}

/** `git diff` output split at each `diff --git` line; text before the first is dropped. */
export function splitPatch(text: string): PatchSection[] {
  const sections: PatchSection[] = [];
  let header: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (header !== null) sections.push({ header, body: body.join("\n") });
  };
  for (const line of text.split("\n")) {
    if (line.startsWith("diff --git ")) {
      flush();
      header = line;
      body = [];
    } else if (header !== null) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

/**
 * A path as git writes it in a `diff --git` line with `core.quotePath=false`: as it is, unless it
 * holds a double quote, a backslash or a control character — then C-quoted, the way git's
 * quote_c_style does.
 */
export function gitQuote(p: string): string {
  if (!/["\\\x00-\x1f\x7f]/.test(p)) return p;
  let out = '"';
  for (const ch of p) {
    const code = ch.codePointAt(0)!;
    const named = NAMED_ESCAPES[ch];
    if (named !== undefined) out += `\\${named}`;
    else if (code < 0x20 || code === 0x7f) out += `\\${code.toString(8).padStart(3, "0")}`;
    else out += ch;
  }
  return `${out}"`;
}

const NAMED_ESCAPES: Record<string, string> = {
  "\x07": "a",
  "\b": "b",
  "\t": "t",
  "\n": "n",
  "\v": "v",
  "\f": "f",
  "\r": "r",
  '"': '"',
  "\\": "\\",
};

/** The `diff --git` line git writes for a file at `oldPath` → `newPath` (the same path unless renamed). */
export function gitHeader(oldPath: string, newPath: string): string {
  return `diff --git ${gitQuote(`a/${oldPath}`)} ${gitQuote(`b/${newPath}`)}`;
}
