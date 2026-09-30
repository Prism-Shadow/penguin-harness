/**
 * Where the built-in browser's pages sit (features/builtin-browser/geometry.ts): the page on
 * screen covers the visible part of the dock's slot at the slot's full size, every other page
 * parks off-screen at a real size, and a frame that computes the same boxes writes nothing.
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

  it("defaults to a desktop viewport, and remembers the size a page was shown at", () => {
    expect(DEFAULT_PARK_SIZE).toEqual({ width: 1280, height: 800 });
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
