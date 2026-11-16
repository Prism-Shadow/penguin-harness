// @vitest-environment jsdom
/**
 * The gutter of an unwrapped numbered code surface (the UI package's CodeSurface, as the Files
 * panel's source view and editor draw it with Wrap off), inside a box that scrolls sideways.
 *
 * - Given an unwrapped file, the numbers are one column with a number for every line, which
 *   follows the file as lines are added.
 * - Given the box scrolled sideways, the code is clipped under the numbers; given a new file
 *   shown with the box back at its left edge — without a scroll event — nothing is clipped, so no
 *   clip from the previous file cuts the start off the new one's lines.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createElement as h } from "react";
import { CodeSurface } from "@prismshadow/penguin-ui";
import { mount, unmountAll } from "./helpers/dom";

function Frame({ code }: { code: string }) {
  return h(
    "div",
    { "data-testid": "box", style: { overflowX: "auto" } },
    h(CodeSurface, { language: "text", code, lineNumbers: true, wrap: false, highlight: false }),
  );
}

const box = () => document.querySelector<HTMLElement>('[data-testid="box"]')!;
const numbers = () => document.querySelector(".code-gutter")?.textContent?.split("\n") ?? [];
const codeLayer = () => document.querySelector<HTMLElement>(".code-surface > pre")!;

/** Where the box stands sideways: jsdom lays nothing out, so the test says. */
function scrolledTo(el: HTMLElement): { set: (x: number) => void } {
  let left = 0;
  Object.defineProperty(el, "scrollLeft", { configurable: true, get: () => left });
  return {
    set: (x) => {
      left = x;
    },
  };
}

afterEach(async () => {
  await unmountAll();
});

describe("an unwrapped surface's gutter", () => {
  it("numbers every line in one column, following the file as lines are added", async () => {
    const page = await mount(h(Frame, { code: "a\nb" }));
    expect(numbers()).toEqual(["1", "2"]);

    await page.rerender(h(Frame, { code: "a\nb\nc" }));
    expect(numbers()).toEqual(["1", "2", "3"]);
  });

  it("clips the code while scrolled sideways, and leaves a new file at the left edge unclipped", async () => {
    const page = await mount(h(Frame, { code: "first file" }));
    const scroll = scrolledTo(box());

    scroll.set(140);
    await page.rerender(h(Frame, { code: "first file, scrolled" }));
    expect(codeLayer().style.clipPath).not.toBe("");

    scroll.set(0);
    await page.rerender(h(Frame, { code: "second file" }));
    expect(codeLayer().style.clipPath).toBe("");
  });
});
