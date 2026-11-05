/**
 * Where the built-in browser's pages sit (features/builtin-browser/geometry.ts).
 *
 * - The page on screen covers a fully visible slot exactly; a clipped slot clips the frame to
 *   the dock's window while the page keeps the slot's size, offset by what the clip cuts off.
 * - With no slot, an empty one, or nothing of it visible, the page parks far off-screen at a
 *   real size; the size a page was last shown at is remembered, a parked page's is not.
 * - A dock surface lifted to fullscreen over the slot (the bottom dock climbing over the right
 *   one) takes what it covers off the frame, edge first, and parks a page it covers whole; one
 *   that only meets a corner leaves the page as it is.
 * - Edges snap to whole pixels (edges rounded, not sizes), so a slot and its frame never open
 *   a seam; rectangles intersect, reporting no overlap as null.
 * - A frame that computes the same boxes writes nothing.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_PARK_SIZE,
  PARK_LEFT,
  intersect,
  parkedPlacement,
  samePlacement,
  shownSize,
  slotPlacement,
  snapRect,
} from "../src/features/builtin-browser/geometry";

const slot = { left: 800, top: 100, width: 480, height: 700 };
const viewport = { left: 0, top: 0, width: 1280, height: 900 };

describe("slotPlacement", () => {
  it("covers a fully visible slot exactly", () => {
    const placement = slotPlacement(slot, [viewport], DEFAULT_PARK_SIZE);
    expect(placement.shown).toBe(true);
    expect(placement.frame).toEqual(slot);
    expect(placement.view).toEqual({ left: 0, top: 0, width: 480, height: 700 });
  });

  it("clips the frame to the dock's window while the page keeps the slot's size", () => {
    // A right dock halfway through sliding open: its clipping window shows the slot's left part.
    const dockWindow = { left: 1040, top: 100, width: 240, height: 700 };
    const placement = slotPlacement(
      { ...slot, left: 1040 },
      [dockWindow, viewport],
      DEFAULT_PARK_SIZE,
    );
    expect(placement.frame).toEqual({ left: 1040, top: 100, width: 240, height: 700 });
    expect(placement.view).toEqual({ left: 0, top: 0, width: 480, height: 700 });
  });

  it("offsets the page when the clip cuts the slot's top or left", () => {
    const placement = slotPlacement(slot, [{ left: 900, top: 300, width: 1000, height: 1000 }], {
      width: 1,
      height: 1,
    });
    expect(placement.frame).toEqual({ left: 900, top: 300, width: 380, height: 500 });
    expect(placement.view).toEqual({ left: -100, top: -200, width: 480, height: 700 });
  });

  it("parks the page when there is no slot, an empty one, or nothing of it visible", () => {
    const park = { width: 640, height: 480 };
    expect(slotPlacement(null, [], park)).toEqual(parkedPlacement(park));
    expect(slotPlacement({ ...slot, width: 0 }, [], park)).toEqual(parkedPlacement(park));
    expect(slotPlacement(slot, [{ left: 0, top: 0, width: 100, height: 100 }], park)).toEqual(
      parkedPlacement(park),
    );
  });

  it("cuts what a lifted surface of the other dock covers, from the edge it climbs over", () => {
    // The bottom dock on its way to fullscreen: its box has climbed to y=500 across the whole
    // area, over the lower part of the right dock's slot.
    const climbing = { left: 300, top: 500, width: 980, height: 400 };
    const placement = slotPlacement(slot, [viewport], DEFAULT_PARK_SIZE, [climbing]);
    expect(placement.frame).toEqual({ left: 800, top: 100, width: 480, height: 400 });
    expect(placement.view).toEqual({ left: 0, top: 0, width: 480, height: 700 });
    // Arrived: it covers the slot whole, and the page parks.
    const arrived = { left: 300, top: 60, width: 980, height: 840 };
    expect(slotPlacement(slot, [viewport], DEFAULT_PARK_SIZE, [arrived]).shown).toBe(false);
  });

  it("cuts from whichever edge a cover reaches across, and ignores one beside the slot", () => {
    const place = (cover: { left: number; top: number; width: number; height: number }) =>
      slotPlacement(slot, [viewport], DEFAULT_PARK_SIZE, [cover]).frame;
    expect(place({ left: 700, top: 0, width: 700, height: 300 })).toEqual({
      left: 800,
      top: 300,
      width: 480,
      height: 500,
    });
    expect(place({ left: 1000, top: 0, width: 400, height: 900 })).toEqual({
      left: 800,
      top: 100,
      width: 200,
      height: 700,
    });
    expect(place({ left: 0, top: 0, width: 900, height: 900 })).toEqual({
      left: 900,
      top: 100,
      width: 380,
      height: 700,
    });
    expect(place({ left: 0, top: 0, width: 800, height: 900 })).toEqual(slot);
  });

  it("leaves the page whole under a cover that only meets a corner of it", () => {
    const corner = { left: 1200, top: 700, width: 200, height: 200 };
    expect(slotPlacement(slot, [viewport], DEFAULT_PARK_SIZE, [corner]).frame).toEqual(slot);
  });

  it("snaps edges to whole pixels, so a slot and its frame never open a seam", () => {
    const placement = slotPlacement(
      { left: 800.4, top: 99.6, width: 479.4, height: 700.6 },
      [],
      DEFAULT_PARK_SIZE,
    );
    expect(placement.frame).toEqual({ left: 800, top: 100, width: 480, height: 700 });
  });
});

describe("parking", () => {
  it("parks far off-screen at the given size", () => {
    const placement = parkedPlacement(DEFAULT_PARK_SIZE);
    expect(placement.shown).toBe(false);
    expect(placement.frame.left).toBe(PARK_LEFT);
    expect(placement.frame.left + placement.frame.width).toBeLessThan(0);
    expect(placement.view).toEqual({ left: 0, top: 0, ...DEFAULT_PARK_SIZE });
  });

  it("remembers the size a page was shown at, and none for a parked page", () => {
    expect(shownSize(slotPlacement(slot, [], DEFAULT_PARK_SIZE))).toEqual({
      width: 480,
      height: 700,
    });
    expect(shownSize(parkedPlacement(DEFAULT_PARK_SIZE))).toBeNull();
  });
});

describe("rect helpers", () => {
  it("intersects, and reports no overlap as null", () => {
    expect(intersect(slot, viewport)).toEqual({ left: 800, top: 100, width: 480, height: 700 });
    expect(intersect(slot, { left: 0, top: 0, width: 800, height: 900 })).toBeNull();
  });

  it("rounds edges rather than sizes", () => {
    expect(snapRect({ left: 0.5, top: 0.5, width: 10, height: 10 })).toEqual({
      left: 1,
      top: 1,
      width: 10,
      height: 10,
    });
    expect(snapRect({ left: 0.4, top: 0, width: 10.2, height: 1 })).toEqual({
      left: 0,
      top: 0,
      width: 11,
      height: 1,
    });
  });

  it("writes nothing when a frame computes the same boxes", () => {
    const a = slotPlacement(slot, [], DEFAULT_PARK_SIZE);
    const b = slotPlacement({ ...slot }, [], DEFAULT_PARK_SIZE);
    expect(samePlacement(a, b)).toBe(true);
    expect(samePlacement(undefined, b)).toBe(false);
    expect(samePlacement(a, parkedPlacement(DEFAULT_PARK_SIZE))).toBe(false);
  });
});
