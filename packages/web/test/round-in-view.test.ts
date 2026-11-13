/**
 * Which round the rounds button names (features/traces/round-in-view.ts): the first drawn round
 * showing under the sticky toolbar whole, or by at least a head and a half.
 *
 * - Collapsed rows: the first row fully under the toolbar, not one half hidden behind it.
 * - An open round whose body fills the view stays the round in view after its head is gone.
 * - A jumped-to head sitting a little below the toolbar wins over the sliver of the round above.
 * - Scrolled to the end, it is the last drawn round.
 * - With no round on screen yet, it is the first drawn round; with none drawn, there is none.
 */
import { describe, expect, it } from "vitest";
import { roundInView } from "../src/features/traces/round-in-view";

const HEAD = 30;
/** A row from `top`, `height` tall (a collapsed row is one head). */
const row = (taskIndex: number, top: number, height = HEAD) => ({
  taskIndex,
  top,
  bottom: top + height,
  headHeight: HEAD,
});
/** The toolbar ends at 40, the scroll box at 800. */
const view = { line: 40, bottom: 800, atEnd: false };

describe("the round in view", () => {
  it("among collapsed rows, is the first one fully under the toolbar", () => {
    expect(roundInView([row(7, 0), row(8, 30), row(9, 60), row(10, 90)], view)).toBe(9);
    expect(roundInView([row(7, 10), row(8, 40), row(9, 70)], view)).toBe(8);
  });

  it("is an open round filling the view, its head long scrolled away", () => {
    expect(roundInView([row(7, -900, 1500), row(8, 600)], view)).toBe(7);
  });

  it("is a jumped-to head below the toolbar, over the sliver of the round above", () => {
    expect(roundInView([row(38, -2000, 2075), row(39, 75, 900)], view)).toBe(39);
  });

  it("is the last drawn round once the panel is scrolled to its end", () => {
    expect(roundInView([row(7, 40), row(8, 70), row(9, 100)], { ...view, atEnd: true })).toBe(9);
  });

  it("is the first drawn round with none on screen yet, and none with none drawn", () => {
    expect(roundInView([row(3, 900), row(4, 930)], view)).toBe(3);
    expect(roundInView([], view)).toBeNull();
    expect(roundInView([], { ...view, atEnd: true })).toBeNull();
  });
});
