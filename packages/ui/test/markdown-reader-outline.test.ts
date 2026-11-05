/**
 * The Markdown reader's outline as numbers (components/content/markdown-reader/outline.ts): which
 * headings it lists and how deep, which section is current as the reader scrolls, and where a row
 * scrolls the reader to. The reader's DOM half (reading the headings, the rail and the popover,
 * the scroll itself) is the web app's markdown-reader suite.
 *
 * - A document that starts at `##` indents from `##`, not from an empty `#` level; a heading with
 *   no text is left out, and so is anything deeper than h4.
 * - Before any heading has passed the reading line, the first section is current; once the reader
 *   has scrolled past a heading, that section is; at the end of the scroll, the last section is,
 *   even when its heading sits too low ever to reach the top of the box.
 * - The reading line slides down the box as the scroll runs, so a short section near the end is
 *   current for a stretch of its own before the last one takes over.
 * - A box that does not scroll shows every section at once, and the first is current; a document
 *   with no headings has no current section.
 * - A row scrolls its heading to just below the top of the box, never above the start of the
 *   scroll and never past its end.
 */
import { describe, expect, it } from "vitest";
import {
  activeEntry,
  outlineEntries,
  scrollTargetFor,
} from "../src/components/content/markdown-reader/outline";

describe("the outline's entries", () => {
  it("indents from the shallowest rank the document uses", () => {
    expect(
      outlineEntries([
        { level: 2, text: "Before the release" },
        { level: 3, text: "Version numbers" },
        { level: 4, text: "Burned numbers" },
        { level: 2, text: "Rolling back" },
      ]).map((entry) => [entry.depth, entry.text]),
    ).toEqual([
      [0, "Before the release"],
      [1, "Version numbers"],
      [2, "Burned numbers"],
      [0, "Rolling back"],
    ]);
  });

  it("leaves out headings with no text and headings deeper than h4", () => {
    expect(
      outlineEntries([
        { level: 1, text: "发布流程" },
        { level: 2, text: "   " },
        { level: 5, text: "Too deep" },
        { level: 2, text: "回滚\n  步骤" },
      ]).map((entry) => entry.text),
    ).toEqual(["发布流程", "回滚 步骤"]);
  });
});

describe("the current section", () => {
  /** Four headings down a 2000px document read through a 500px box. */
  const TOPS = [0, 600, 1200, 1900];
  const box = (top: number) => ({ top, height: 2000, viewport: 500 });

  it("is the first before any heading has passed the reading line", () => {
    expect(activeEntry([300, 900], box(0))).toBe(0);
  });

  it("is the section whose heading the reader has scrolled past", () => {
    expect(activeEntry(TOPS, box(620))).toBe(1);
    expect(activeEntry(TOPS, box(1210))).toBe(2);
  });

  it("is the last one at the end of the scroll, though its heading never reaches the top", () => {
    expect(activeEntry(TOPS, box(1500))).toBe(3);
  });

  it("gives a short section near the end a stretch of its own before the last takes over", () => {
    const tops = [0, 1000, 1700, 1800];
    const seen = new Set<number>();
    for (let top = 0; top <= 1500; top += 10) seen.add(activeEntry(tops, box(top)));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("is the first in a box that does not scroll, and none in a document without headings", () => {
    expect(activeEntry([0, 120, 240], { top: 0, height: 400, viewport: 500 })).toBe(0);
    expect(activeEntry([], box(300))).toBe(-1);
  });
});

describe("where a row scrolls to", () => {
  const box = { height: 2000, viewport: 500 };

  it("brings the heading just below the top of the box", () => {
    const target = scrollTargetFor(800, box);
    expect(target).toBeLessThan(800);
    expect(800 - target).toBeLessThan(24);
  });

  it("stops at either end of the scroll", () => {
    expect(scrollTargetFor(2, box)).toBe(0);
    expect(scrollTargetFor(1900, box)).toBe(1500);
  });
});
