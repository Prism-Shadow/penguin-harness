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

/**
 * Cuts Shiki's block-line markup (highlighter-core.ts's `blockLines`) into its lines. Null where
 * there is no DOM to parse with (the server renderer) or the markup is not that shape — the
 * caller then draws the block whole, as it always could.
 */
export function splitHighlighted(html: string): HighlightedLines | null {
  if (typeof document === "undefined") return null;
  const template = document.createElement("template");
  template.innerHTML = html;
  const pre = template.content.querySelector("pre");
  const body = pre?.querySelector(":scope > code");
  if (!pre || !body) return null;
  const lines = [...body.children];
  if (lines.length !== body.childNodes.length || lines.some((l) => !l.classList.contains("line"))) {
    return null;
  }
  const tab = pre.getAttribute("tabindex");
  return {
    pre: {
      className: pre.getAttribute("class") ?? "",
      style: styleObject(pre.getAttribute("style") ?? ""),
      tabIndex: tab === null ? undefined : Number(tab),
    },
    lines: lines.map((line) => ({
      text: line.textContent ?? "",
      html: { __html: line.innerHTML },
    })),
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
 * The rows to draw for `lines`. A line before or after the edit keeps the key of the row it was
 * in `previous`, so its element (and the number drawn in front of it) stays. The lines the edit
 * touched take over the keys of the rows they replace, in order — a line typed in keeps its
 * element too — and only lines beyond those get new keys. A line keeps its colours from
 * `highlighted` while it is one of the lines that rendering was made of, aligned the same way,
 * and is plain otherwise.
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
    hl.map((line) => line.text),
    lines,
  );
  /** How many rows of `previous` the edit replaced: their keys go to the lines that replace them. */
  const replaced = previous.length - kept.head - kept.tail;
  return lines.map((text, i) => {
    const fromEnd = lines.length - 1 - i;
    const key =
      i < kept.head
        ? previous[i]!.key
        : fromEnd < kept.tail
          ? previous[previous.length - 1 - fromEnd]!.key
          : i - kept.head < replaced
            ? previous[i]!.key
            : newKey();
    const html =
      i < coloured.head
        ? hl[i]!.html
        : fromEnd < coloured.tail
          ? hl[hl.length - 1 - fromEnd]!.html
          : null;
    return { key, text, html };
  });
}
