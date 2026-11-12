/**
 * Where the floating ball rests, travels and lands (src/components/shell/floating-ball/
 * floating-ball-geometry.ts), in an area of a given size. The metrics are this suite's own, so
 * every expectation is derived from them rather than from the package's defaults.
 *
 * - Given the bottom of the right edge, the ball rests in the bottom-right corner, the inset
 *   from both edges.
 * - Given a release left of the area's middle, the ball lands on the left edge; right of it, on
 *   the right edge, at the height it was let go at.
 * - Given a drag however far past the area, the ball never rises above the top inset nor sinks
 *   below the bottom one, and its centre goes no further out than a side edge.
 * - Given a release with the centre pushed into a side edge, the ball is tucked on that edge;
 *   let go merely near the edge, it is not.
 * - Given a height the reader chose, a page that shrinks keeps the ball inside it and a page
 *   that grows back returns it to that height, the ratio untouched.
 * - Given an area shorter than the ball and its insets, the ball pins at the top inset.
 * - Given an area with no height, a release keeps the height it had.
 * - Given a stored value, only a whole placement reads back: anything else is nothing, a ratio
 *   past either end is clamped, and an absent `tucked` reads as not tucked.
 */
import { describe, expect, it } from "vitest";
import {
  coerceFloatingBallPlacement,
  floatingBallDrag,
  floatingBallDrop,
  floatingBallInTuckZone,
  floatingBallRest,
  type FloatingBallMetrics,
  type FloatingBallPlacement,
} from "../src/components/shell/floating-ball/floating-ball-geometry";

const M: FloatingBallMetrics = { size: 40, inset: 10, tuckZone: 8 };
const AREA = { width: 800, height: 600 };
const CORNER: FloatingBallPlacement = { side: "right", ratio: 1, tucked: false };
/** The ball's top-left for a centre at (x, y). */
const at = (x: number, y: number) => ({ left: x - M.size / 2, top: y - M.size / 2 });

describe("the floating ball's geometry", () => {
  it("rests in the bottom-right corner at the bottom of the right edge", () => {
    const rest = floatingBallRest(CORNER, AREA, M);
    expect(rest.left + M.size).toBe(AREA.width - M.inset);
    expect(rest.top + M.size).toBe(AREA.height - M.inset);
  });

  it("lands on the side of the area's middle it was let go on, at that height", () => {
    const left = floatingBallDrop(at(399, 300), AREA, CORNER, M);
    expect(left).toEqual({ side: "left", ratio: 0.5, tucked: false });
    expect(floatingBallRest(left, AREA, M)).toEqual({ left: M.inset, top: 300 - M.size / 2 });
    const right = floatingBallDrop(at(401, 150), AREA, CORNER, M);
    expect(right).toEqual({ side: "right", ratio: 0.25, tucked: false });
  });

  it("never leaves the area vertically, and goes out sideways only as far as its centre on the edge", () => {
    const start = floatingBallRest(CORNER, AREA, M);
    const up = floatingBallDrag(start, 0, -5000, AREA, M);
    expect(up.top).toBe(M.inset);
    const down = floatingBallDrag(start, 0, 5000, AREA, M);
    expect(down.top + M.size).toBe(AREA.height - M.inset);
    expect(floatingBallDrag(start, 5000, 0, AREA, M).left + M.size / 2).toBe(AREA.width);
    expect(floatingBallDrag(start, -5000, 0, AREA, M).left + M.size / 2).toBe(0);
  });

  it("is tucked when let go pushed into a side edge, and not when merely near it", () => {
    const pushedRight = at(AREA.width - M.tuckZone + 1, 300);
    expect(floatingBallInTuckZone(pushedRight, AREA, M)).toBe(true);
    expect(floatingBallDrop(pushedRight, AREA, CORNER, M)).toMatchObject({
      side: "right",
      tucked: true,
    });
    const pushedLeft = at(M.tuckZone - 1, 300);
    expect(floatingBallDrop(pushedLeft, AREA, CORNER, M)).toMatchObject({
      side: "left",
      tucked: true,
    });
    const near = at(M.tuckZone + 1, 300);
    expect(floatingBallInTuckZone(near, AREA, M)).toBe(false);
    expect(floatingBallDrop(near, AREA, CORNER, M).tucked).toBe(false);
  });

  it("keeps a chosen height through a page that shrinks and grows back", () => {
    const chosen = floatingBallDrop(at(100, 525), AREA, CORNER, M);
    // Seven eighths of the way down is below the shorter page's last resting place.
    const short = { width: 800, height: 200 };
    expect(floatingBallRest(chosen, short, M).top + M.size).toBe(short.height - M.inset);
    expect(floatingBallRest(chosen, AREA, M).top).toBe(525 - M.size / 2);
  });

  it("pins at the top inset in an area shorter than the ball and its insets", () => {
    const tiny = { width: 800, height: M.size };
    expect(floatingBallRest(CORNER, tiny, M).top).toBe(M.inset);
    expect(floatingBallDrag(floatingBallRest(CORNER, tiny, M), 0, 50, tiny, M).top).toBe(M.inset);
  });

  it("keeps the height it had when the area has none to measure against", () => {
    const placed: FloatingBallPlacement = { side: "left", ratio: 0.3, tucked: false };
    expect(floatingBallDrop(at(700, 0), { width: 800, height: 0 }, placed, M).ratio).toBe(0.3);
  });

  it("reads back only a whole placement from a stored value", () => {
    expect(coerceFloatingBallPlacement({ side: "left", ratio: 0.4, tucked: true })).toEqual({
      side: "left",
      ratio: 0.4,
      tucked: true,
    });
    expect(coerceFloatingBallPlacement({ side: "right", ratio: 3 })).toEqual({
      side: "right",
      ratio: 1,
      tucked: false,
    });
    expect(coerceFloatingBallPlacement({ side: "left", ratio: -1, tucked: false })?.ratio).toBe(0);
    for (const junk of [
      null,
      "right",
      [],
      { side: "top", ratio: 0.5 },
      { side: "left", ratio: Number.NaN },
      { side: "left", ratio: "0.5" },
      { side: "left", ratio: 0.5, tucked: "yes" },
    ]) {
      expect(coerceFloatingBallPlacement(junk)).toBeNull();
    }
  });
});
