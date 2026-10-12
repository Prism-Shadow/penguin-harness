/**
 * Fenced-block scanning on CommonMark's rules, so the checker, the text fallback and the prose
 * lint agree with the Markdown renderer about where a block starts and ends: 3+ backticks or
 * tildes, at most 3 spaces of indentation, the language is the first word of the info string,
 * the closing fence is the same character and at least as long, and the body is de-indented by
 * the opening fence's indentation. Every fence is tracked, whatever its language, because a
 * ```a2ui line inside a longer ````markdown fence is an example, not a block.
 */
import type { A2uiBlock } from "./types.js";

/** One fenced code block as CommonMark delimits it, whatever its language. */
export interface FenceSpan {
  char: "`" | "~";
  /** Length of the opening run; a closing fence needs the same character and at least this length. */
  length: number;
  /** Leading spaces of the opening fence (0–3), removed from each body line where present. */
  indent: number;
  /** The info string after the fence characters, trimmed. */
  info: string;
  /** The first word of the info string, lower-cased: what a renderer dispatches on. */
  lang: string;
  /** 1-based line of the opening fence. */
  startLine: number;
  /** 1-based line of the closing fence, or of the last line when unclosed. */
  endLine: number;
  closed: boolean;
  body: string[];
}

/** Lines of a text, CRLF tolerated. */
export function splitLines(markdown: string): string[] {
  return markdown.split("\n").map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
}

const OPEN_FENCE = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSE_FENCE = /^ {0,3}(`{3,}|~{3,})\s*$/;

export function scanFences(markdown: string): FenceSpan[] {
  const lines = splitLines(markdown);
  const spans: FenceSpan[] = [];
  let open: FenceSpan | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (open === null) {
      const m = OPEN_FENCE.exec(line);
      if (!m) continue;
      const run = m[2] ?? "";
      const info = (m[3] ?? "").trim();
      const char: "`" | "~" = run.startsWith("~") ? "~" : "`";
      // A backtick fence's info string may not contain a backtick (that line is inline code).
      if (char === "`" && info.includes("`")) continue;
      open = {
        char,
        length: run.length,
        indent: (m[1] ?? "").length,
        info,
        lang: (info.split(/\s+/)[0] ?? "").toLowerCase(),
        startLine: i + 1,
        endLine: i + 1,
        closed: false,
        body: [],
      };
      continue;
    }
    const close = CLOSE_FENCE.exec(line);
    const run = close?.[1] ?? "";
    if (close && run.startsWith(open.char) && run.length >= open.length) {
      open.endLine = i + 1;
      open.closed = true;
      spans.push(open);
      open = null;
      continue;
    }
    open.body.push(stripIndent(line, open.indent));
  }
  if (open !== null) {
    open.endLine = lines.length;
    spans.push(open);
  }
  return spans;
}

function stripIndent(line: string, indent: number): string {
  let n = 0;
  while (n < indent && line[n] === " ") n++;
  return line.slice(n);
}

/** The a2ui and mermaid fences among scanned spans, numbered from 1 in order of appearance. */
export function blocksFromFences(spans: FenceSpan[]): A2uiBlock[] {
  const blocks: A2uiBlock[] = [];
  for (const span of spans) {
    if (span.lang !== "a2ui" && span.lang !== "mermaid") continue;
    blocks.push({
      index: blocks.length + 1,
      fence: span.lang === "a2ui" ? "a2ui" : "mermaid",
      source: span.body.join("\n"),
      startLine: span.startLine,
      endLine: span.endLine,
      closed: span.closed,
      info: span.info,
    });
  }
  return blocks;
}

/** Every ```a2ui and ```mermaid block of a reply, unclosed ones included (`closed: false`). */
export function findBlocks(markdown: string): A2uiBlock[] {
  return blocksFromFences(scanFences(markdown));
}

/** The 1-based line numbers covered by fences, fence lines included. */
export function fenceLineSet(spans: FenceSpan[]): Set<number> {
  const set = new Set<number>();
  for (const span of spans) {
    for (let n = span.startLine; n <= span.endLine; n++) set.add(n);
  }
  return set;
}
