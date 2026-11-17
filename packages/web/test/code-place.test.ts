// @vitest-environment jsdom
/**
 * A place in a numbered code surface, carried as a line (the UI package's readCodePlace and
 * restoreCodePlace), between two scroll boxes that lay the same file out at different heights —
 * the source view, whose off-screen lines stand at an estimate, and the editor, whose lines are
 * all laid out. jsdom lays nothing out, so the test says where each box's lines stand.
 *
 * - Given a box scrolled into a file, the place read from it and put back in a box with taller
 *   lines brings the same line to the same distance from the top edge.
 * - Given a box with no numbered lines (a rendered Markdown file), the place read from it is its
 *   pixel offset, and that is what is put back.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { CodeSurface, readCodePlace, restoreCodePlace } from "@prismshadow/penguin-ui";
import { mount, unmountAll } from "./helpers/dom";

const LINES = Array.from({ length: 240 }, (_, i) => `line ${i}`);
const TOP = 100;

function Boxes() {
  const surface = () =>
    h(CodeSurface, {
      language: "text",
      code: LINES.join("\n"),
      lineNumbers: true,
      wrap: true,
      highlight: false,
    });
  return h(
    "div",
    null,
    h("div", { "data-testid": "source", "data-row": "20" }, surface()),
    h("div", { "data-testid": "editor", "data-row": "33" }, surface()),
    h("div", { "data-testid": "plain" }, "no lines here"),
  );
}

const box = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

/** Lays `el`'s lines out one under another, each `data-row` px tall, under a box at TOP. */
function layOut(el: HTMLElement): void {
  const row = Number(el.dataset["row"] ?? "0");
  let scrollTop = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  const rect = (top: number, height: number) =>
    ({
      top,
      bottom: top + height,
      height,
      left: 0,
      right: 600,
      width: 600,
      x: 0,
      y: top,
    }) as DOMRect;
  el.getBoundingClientRect = () => rect(TOP, 400);
  const lines = [...el.querySelectorAll<HTMLElement>(".line-chunk > .line")];
  lines.forEach((line, i) => {
    line.getBoundingClientRect = () => rect(TOP + i * row - scrollTop, row);
  });
  for (const chunk of el.querySelectorAll<HTMLElement>(".line-chunk")) {
    const first = lines.indexOf(chunk.firstElementChild as HTMLElement);
    chunk.getBoundingClientRect = () =>
      rect(TOP + first * row - scrollTop, chunk.children.length * row);
  }
}

/** The line at the box's top edge, and how far its top is from the edge. */
function atTop(el: HTMLElement): { line: number; inset: number } {
  const lines = [...el.querySelectorAll<HTMLElement>(".line-chunk > .line")];
  const line = lines.findIndex((l) => l.getBoundingClientRect().bottom > TOP);
  return { line, inset: lines[line]!.getBoundingClientRect().top - TOP };
}

afterEach(async () => {
  await unmountAll();
});

describe("a place in a file", () => {
  it("is the same line at the same distance from the top in a box with taller lines", async () => {
    await mount(h(Boxes));
    const source = box("source");
    const editor = box("editor");
    layOut(source);
    layOut(editor);
    // Line 150, cut 7px by the top edge.
    source.scrollTop = 150 * 20 + 7;

    restoreCodePlace(editor, readCodePlace(source));

    expect(atTop(source)).toEqual({ line: 150, inset: -7 });
    expect(atTop(editor)).toEqual({ line: 150, inset: -7 });
    expect(editor.scrollTop).toBe(150 * 33 + 7);
  });

  it("is the pixel offset when read from a box with no numbered lines", async () => {
    await mount(h(Boxes));
    const plain = box("plain");
    const editor = box("editor");
    layOut(plain);
    layOut(editor);
    plain.scrollTop = 420;

    restoreCodePlace(editor, readCodePlace(plain));

    expect(editor.scrollTop).toBe(420);
  });
});
