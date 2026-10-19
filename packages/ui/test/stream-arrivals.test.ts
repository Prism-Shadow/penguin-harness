/**
 * Runs of streaming Markdown that are still fading in (components/content/prose/stream-arrivals.ts),
 * rendered through `Md` the way a Frost reply renders while it arrives. The fade itself is the
 * theme's (theme.css, `ui-stream`'s `[data-arrive]`); what is pinned here is what it fades.
 *
 * - Given runs fading inside every kind of block — prose, a heading, a list, bold, a link, inline
 *   code, a code block, a table, math, CJK — the Markdown is exactly what it is without them once
 *   the runs are taken out: no character lost, doubled or moved, and a code block's code (what its
 *   Copy button copies) unchanged.
 * - Given the newest stretches of a paragraph, each is a run carrying its arrival time, and the
 *   text that was on screen before the first live run carries no mark at all.
 * - Given a list item, a code block or a table that arrived whole, the element itself carries its
 *   arrival, so its bullet, frame and rules fade with its text; the text inside is split only by
 *   the runs that came after it.
 * - Given a run that starts inside inline code or after an escape, it starts at the right
 *   character: delimiters and escapes in the source never shift it.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { Md } from "../src/components/content/prose/prose";
import type { RevealArrival } from "../src/components/content/prose/stream-arrivals";
import { renderStatic } from "../src/testing";

const MIXED = [
  "The workspace is **healthy**. Here is what I checked, with [the log](https://example.invalid/log) ",
  "and `penguin.toml` in hand.\n\n",
  "## Summary\n\n",
  "- The build directory is present.\n",
  "- No stray \\*lock\\* files were left.\n\n",
  "```bash\n",
  "for f in build/*.js; do\n",
  '  test -s "$f" || echo "empty"\n',
  "done\n",
  "```\n\n",
  "| Check | Result |\n| --- | --- |\n",
  "| Build | ok |\n",
  "| Locks | none |\n\n",
  "The ratio stays near \\( \\frac{a}{b} \\) across runs.\n\n",
  "$$\nx^2 + y^2\n$$\n\n",
  "中文段落也要平滑地显现。",
].join("");

const render = (text: string, arrivals?: readonly RevealArrival[]) =>
  renderStatic(createElement(Md, { text, streaming: true, arrivals }));

/** The markup with every run taken out: run spans unwrapped, marks and code runs dropped. */
const withoutRuns = (html: string) =>
  html
    .replace(/<span data-arrive="\d+">([^<]*)<\/span>/g, "$1")
    .replace(/ data-arrive="\d+"/g, "")
    .replace(/ data-arrivals="[^"]*"/g, "");

/** Runs every `step` characters from `from`, a millisecond apart. */
const runsFrom = (from: number, to: number, step: number): RevealArrival[] =>
  Array.from({ length: Math.ceil((to - from) / step) }, (_, i) => ({
    start: from + i * step,
    at: 1000 + i,
  }));

describe("runs of Markdown fading in", () => {
  it("never change what the Markdown says, whichever blocks they fall in", () => {
    for (const step of [7, 13, 29]) {
      for (const from of [0, MIXED.indexOf("## Summary"), MIXED.indexOf("```bash")]) {
        for (const length of [MIXED.indexOf("| Check"), MIXED.indexOf("$$"), MIXED.length]) {
          const text = MIXED.slice(0, length);
          const runs = runsFrom(Math.min(from, length - 1), length, step);
          const html = render(text, runs);
          expect(html).toContain("data-arrive");
          expect(withoutRuns(html)).toBe(render(text));
        }
      }
    }
  });

  it("marks each new stretch of a paragraph with its arrival, and nothing that came before", () => {
    const text = "Hello brave new world";
    const html = render(text, [
      { start: text.indexOf("brave"), at: 10 },
      { start: text.indexOf("new"), at: 20 },
    ]);
    expect(html).toBe(
      '<p>Hello <span data-arrive="10">brave </span><span data-arrive="20">new world</span></p>',
    );
  });

  it("fades a list item, a code block and a table that arrived whole as one", () => {
    const text =
      "Intro\n\n- one\n- two\n\n```js\nconst a = 1;\nconst b = 2;\n```\n\n| A |\n| --- |\n| x |";
    const html = render(text, [
      { start: text.indexOf("- one"), at: 5 },
      { start: text.indexOf("- two"), at: 9 },
      { start: text.indexOf("```js"), at: 12 },
      { start: text.indexOf("const b"), at: 15 },
      { start: text.indexOf("| A |"), at: 20 },
    ]);
    // The list came with the first run; its second item with a later one, so it carries its own.
    expect(html).toContain(
      '<ul data-arrive="5">\n<li>one</li>\n<li data-arrive="9">two</li>\n</ul>',
    );
    // The block's frame fades as a whole; the code that came after it is a run inside.
    expect(html).toMatch(/<div class="code-block[^"]*" data-arrive="12">/);
    expect(html).toContain('const a = 1;\n<span data-arrive="15">const b = 2;</span></code>');
    expect(html).toContain('<table data-arrive="20">');
    expect(html.match(/data-arrive="20"/g)).toHaveLength(1);
  });

  it("starts a run at the right character inside inline code and after an escape", () => {
    const code = "Run `npm ci` now";
    expect(render(code, [{ start: code.indexOf("ci`"), at: 7 }])).toBe(
      '<p>Run <code>npm <span data-arrive="7">ci</span></code><span data-arrive="7"> now</span></p>',
    );
    const escaped = "a \\*b\\* c d";
    expect(render(escaped, [{ start: escaped.indexOf("c d"), at: 3 }])).toBe(
      '<p>a *b* <span data-arrive="3">c d</span></p>',
    );
  });
});
