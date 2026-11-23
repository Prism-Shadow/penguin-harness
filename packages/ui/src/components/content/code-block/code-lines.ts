/**
 * A numbered code surface's lines, one element per line that outlives an edit.
 *
 * A numbered surface (the Files panel's source view and its editor) draws each line as an element
 * of its own, its number painted in front of it (prose.css's gutter). Re-rendering the whole
 * block for every change — Shiki's markup swapped for plain text on a keystroke, and back once
 * the highlight lands — rebuilt every line and every number twice per pause in typing, and the
 * colours dropped out of the whole file for as long as the typing lasted. Instead the surface
 * keeps a line's element for as long as the line is there (`alignRows`), and keeps a line's
 * colours for as long as its text is the text that was highlighted: only the lines an edit
 * touched are drawn plain until the next highlight lands.
 */
import type { CSSProperties } from "react";

/** A highlighted rendering cut into its lines. */
export interface HighlightedLines {
  /** The `<pre>` Shiki wraps the lines in: its classes, its inline colours and its tab stop. */
  pre: { className: string; style: CSSProperties; tabIndex: number | undefined };
  /** Each line's text, and its markup inside the line element. */
  lines: readonly { text: string; html: { __html: string } }[];
}

/** One drawn line: the identity its element keeps, its text, and its colours when it has them. */
export interface CodeRow {
  key: number;
  text: string;
  html: { __html: string } | null;
}

/** A `style` attribute as React's style object; custom properties keep their names. */
function styleObject(text: string): CSSProperties {
  const out: Record<string, string> = {};
  for (const part of text.split(";")) {
    const at = part.indexOf(":");
    if (at <= 0) continue;
    const name = part.slice(0, at).trim();
    out[
      name.startsWith("--") ? name : name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())
    ] = part.slice(at + 1).trim();
  }
  return out as CSSProperties;
}

/** One attribute of an opening tag, or undefined when it has none. */
function attribute(tag: string, name: string): string | undefined {
  return new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
}

/**
 * Highlighted markup cut into its lines' inner markup, or null when it does not have the shape a
 * block-lines highlight produces (a `<code>` of `<span class="line">` elements) or the count is
 * not `expected`.
 */
export function splitHighlightedLines(html: string, expected: number): string[] | null {
  const open = html.indexOf("<code>");
  const close = html.lastIndexOf("</code>");
  if (open === -1 || close < open) return null;
  const parts = html.slice(open + "<code>".length, close).split(/<span class="line(?: [^"]*)?">/);
  if (parts.shift() !== "") return null;
  const lines = parts.map((part) => (part.endsWith("</span>") ? part.slice(0, -7) : part));
  return lines.length === expected ? lines : null;
}

/**
 * Cuts Shiki's block-line markup (highlighter-core.ts's `blockLines`) for `code` into its lines,
 * as a string: a large file costs a split, not a second DOM. Null where the markup is not that
 * shape or does not hold `code`'s lines — the caller then draws the block whole.
 */
export function splitHighlighted(html: string, code: string): HighlightedLines | null {
  const tag = /^<pre\b[^>]*>/.exec(html)?.[0];
  // Shiki splits on `\r?\n` and keeps no carriage return.
  const texts = code.split(/\r?\n/);
  const markup = splitHighlightedLines(html, texts.length);
  if (tag === undefined || markup === null) return null;
  const tab = attribute(tag, "tabindex");
  return {
    pre: {
      className: attribute(tag, "class") ?? "",
      style: styleObject(attribute(tag, "style") ?? ""),
      tabIndex: tab === undefined ? undefined : Number(tab),
    },
    lines: markup.map((line, i) => ({ text: texts[i]!, html: { __html: line } })),
  };
}

/** How many entries two lists share at their head, and then at their tail. */
function common(a: readonly string[], b: readonly string[]): { head: number; tail: number } {
  const max = Math.min(a.length, b.length);
  let head = 0;
  while (head < max && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < max - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  return { head, tail };
}

/**
 * A line as Shiki compares it: Shiki splits on `\r?\n` and keeps no carriage return, while the
 * surface splits on `\n` alone, so a CRLF file's lines end in `\r` on one side only.
 */
const bare = (text: string): string => (text.endsWith("\r") ? text.slice(0, -1) : text);

/**
 * The rows to draw for `lines`. A line before or after the edit keeps the key of the row it was
 * in `previous`, so its element (and the number drawn in front of it) stays. The lines the edit
 * touched take over the keys of the rows they replace, in order — a line typed in keeps its
 * element too — and only lines beyond those get new keys. A line keeps its colours from
 * `highlighted` while it is one of the lines that rendering was made of, aligned the same way
 * (a carriage return aside), and is plain otherwise. A row whose markup is the same as its
 * element already holds keeps that very object: React rewrites an element's inner HTML whenever
 * the object changes, so a fresh highlight would otherwise rewrite every line it left alone.
 */
export function alignRows(
  previous: readonly CodeRow[],
  lines: readonly string[],
  highlighted: HighlightedLines | null,
  newKey: () => number,
): CodeRow[] {
  const kept = common(
    previous.map((row) => row.text),
    lines,
  );
  const hl = highlighted?.lines ?? [];
  const coloured = common(
    hl.map((line) => bare(line.text)),
    lines.map(bare),
  );
  /** How many rows of `previous` the edit replaced: their keys go to the lines that replace them. */
  const replaced = previous.length - kept.head - kept.tail;
  return lines.map((text, i) => {
    const fromEnd = lines.length - 1 - i;
    const before =
      i < kept.head || (fromEnd >= kept.tail && i - kept.head < replaced)
        ? previous[i]!
        : fromEnd < kept.tail
          ? previous[previous.length - 1 - fromEnd]!
          : null;
    const markup =
      i < coloured.head
        ? hl[i]!.html
        : fromEnd < coloured.tail
          ? hl[hl.length - 1 - fromEnd]!.html
          : null;
    const html = markup !== null && before?.html?.__html === markup.__html ? before.html : markup;
    return { key: before?.key ?? newKey(), text, html };
  });
}

/**
 * Lines per chunk of a numbered surface, which the browser draws or skips as one (prose.css's
 * `.line-chunk`): drawing one as it scrolls into view takes a few milliseconds, and a file of
 * tens of thousands of lines is a few hundred boxes.
 */
export const CHUNK_LINES = 100;

/** A run of rows drawn as one box. */
export interface RowChunk {
  /** The index of its first line in the file. */
  start: number;
  rows: readonly CodeRow[];
}

/** `rows` in chunks of {@link CHUNK_LINES}, in order. */
export function chunkRows(rows: readonly CodeRow[]): RowChunk[] {
  const chunks: RowChunk[] = [];
  for (let start = 0; start < rows.length; start += CHUNK_LINES) {
    chunks.push({ start, rows: rows.slice(start, start + CHUNK_LINES) });
  }
  return chunks;
}
