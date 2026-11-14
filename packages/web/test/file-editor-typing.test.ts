// @vitest-environment jsdom
/**
 * Typing in the Files panel's editor (the UI package's WorkspaceFileEditor over CodeSurface),
 * with a highlighter that colours every line, and the clock under the test's control so the
 * editor's settle delay passes only when the test says so.
 *
 * - Given a highlighted file, typing on one line keeps every line's element — and the number
 *   drawn with it — in place: the lines the typing did not touch keep their colours, the typed
 *   line shows its new text plain, and takes its colours back when the next highlight lands,
 *   which leaves the untouched lines' markup as it was rather than rewriting it.
 * - Given a new line typed, the lines after it keep their elements, one number further down.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement as h, useState } from "react";
import { CodeHighlighterProvider, WorkspaceFileEditor } from "@prismshadow/penguin-ui";
import type { CodeHighlighter } from "@prismshadow/penguin-ui";
import { mount, type, unmountAll } from "./helpers/dom";

const CODE = ["const a = 1;", "const b = 2;", "const c = 3;", "const d = 4;"].join("\n");

const escape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/** Shiki's block-line shape: every line one coloured token. */
const highlighter: CodeHighlighter = async (code) =>
  `<pre class="shiki" style="color:#111;--shiki-dark:#eee" tabindex="0"><code>${code
    .split("\n")
    .map((line) => `<span class="line"><span style="color:#c00">${escape(line)}</span></span>`)
    .join("")}</code></pre>`;

function Editor() {
  const [value, setValue] = useState(CODE);
  return h(WorkspaceFileEditor, {
    path: "a.ts",
    value,
    label: "Editing a.ts",
    wrap: true,
    onChange: setValue,
    onSave: () => {},
  });
}

/** Lets the editor's settle delay pass, and the highlight it starts land. */
const settleHighlight = () =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });

const lineElements = () => [...document.querySelectorAll<HTMLElement>(".code-editor .line")];
/** Whether each element is the very node at the same place in `was` (not one built like it). */
const same = (now: readonly HTMLElement[], was: readonly (HTMLElement | undefined)[]) =>
  now.map((el, i) => el === was[i]);
const coloured = (line: HTMLElement) => line.querySelector("span[style]") !== null;
const textarea = () => document.querySelector("textarea")!;

afterEach(async () => {
  vi.useRealTimers();
  await unmountAll();
});

describe("typing in the file editor", () => {
  it("keeps every line's element, and the untouched lines' colours, while one line is typed in", async () => {
    vi.useFakeTimers();
    await mount(h(CodeHighlighterProvider, { highlight: highlighter }, h(Editor)));
    await settleHighlight();
    const before = lineElements();
    expect(before.map(coloured)).toEqual([true, true, true, true]);
    const firstToken = before[0]!.querySelector("span[style]");

    await type(textarea(), CODE.replace("const b = 2;", "const b = 22;"));

    const typing = lineElements();
    expect(same(typing, before)).toEqual([true, true, true, true]);
    expect(typing.map(coloured)).toEqual([true, false, true, true]);
    expect(typing[1]!.textContent).toBe("const b = 22;");

    await settleHighlight();
    expect(same(lineElements(), before)).toEqual([true, true, true, true]);
    expect(lineElements().map(coloured)).toEqual([true, true, true, true]);
    expect(lineElements()[0]!.querySelector("span[style]")).toBe(firstToken);
  });

  it("keeps the elements of the lines after a new line, one number further down", async () => {
    vi.useFakeTimers();
    await mount(h(CodeHighlighterProvider, { highlight: highlighter }, h(Editor)));
    await settleHighlight();
    const [first, second, third, fourth] = lineElements();

    await type(textarea(), CODE.replace("const a = 1;", "const a = 1;\n"));

    const after = lineElements();
    expect(same(after, [first, undefined, second, third, fourth])).toEqual([
      true,
      false,
      true,
      true,
      true,
    ]);
    expect(after.map(coloured)).toEqual([true, false, true, true, true]);
  });
});
