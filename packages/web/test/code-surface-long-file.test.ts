// @vitest-environment jsdom
/**
 * A numbered code surface over a file longer than one chunk of lines (the UI package's
 * CodeSurface and WorkspaceFileEditor, as the Files panel draws a large file), with a
 * highlighter that colours every line.
 *
 * - Given a long file, every line is in the document, in order and coloured, and the lines are
 *   numbered through from 1 — each chunk's first line starts the count where the chunks before
 *   it ended.
 * - Given a line typed in near the top of a long file in the editor, every line is still there, in
 *   order, though lines moved from one chunk into the next.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement as h, useState } from "react";
import { CodeSurface, WorkspaceFileEditor } from "@prismshadow/penguin-ui";
import type { CodeHighlighter } from "@prismshadow/penguin-ui";
import { mount, type, unmountAll, waitFor } from "./helpers/dom";

const LINES = Array.from({ length: 250 }, (_, i) => `const value${i} = ${i};`);
const CODE = LINES.join("\n");

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Shiki's block-line shape: every line one coloured token. */
const highlighter: CodeHighlighter = async (code) =>
  `<pre class="shiki" style="color:#111;--shiki-dark:#eee" tabindex="0"><code>${code
    .split("\n")
    .map((line) => `<span class="line"><span style="color:#c00">${escape(line)}</span></span>`)
    .join("")}</code></pre>`;

const lineElements = () => [...document.querySelectorAll<HTMLElement>(".code-surface .line")];
const texts = () => lineElements().map((line) => line.textContent);
const coloured = (line: HTMLElement) => line.querySelector("span[style]") !== null;
/** The number a source view draws each line with: its chunk's start and its place in it. */
const numbers = () =>
  [...document.querySelectorAll<HTMLElement>(".code-surface .line-chunk")].flatMap((chunk) => {
    const start = Number(chunk.style.getPropertyValue("--chunk-start"));
    return [...chunk.children].map((_, i) => start + i + 1);
  });
const through = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

afterEach(async () => {
  await unmountAll();
});

describe("a numbered surface over a long file", () => {
  it("holds every line, in order and coloured, numbered through from 1", async () => {
    await mount(
      h(CodeSurface, {
        language: "ts",
        code: CODE,
        lineNumbers: true,
        wrap: true,
        highlight: highlighter,
      }),
    );
    await waitFor(() => lineElements().some(coloured), 50);

    expect(texts()).toEqual(LINES);
    expect(lineElements().every(coloured)).toBe(true);
    expect(numbers()).toEqual(through(LINES.length));
  });

  it("keeps every line in order when a line is typed in near the top", async () => {
    function Editor() {
      const [value, setValue] = useState(CODE);
      return h(WorkspaceFileEditor, {
        path: "a.ts",
        value,
        label: "Editing a.ts",
        wrap: true,
        highlight: false,
        onChange: setValue,
        onSave: () => {},
      });
    }
    await mount(h(Editor));
    const next = [LINES[0]!, "// a new line", ...LINES.slice(1)];

    await type(document.querySelector("textarea")!, next.join("\n"));

    expect(texts()).toEqual(next);
  });
});
