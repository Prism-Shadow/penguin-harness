/**
 * Where an unfolding surface rests and what it folds back to
 * (src/components/overlays/unfold-surface/unfold-geometry.ts), on rectangles a browser would
 * report.
 *
 * - Given room around its origin, the surface is centred on it across and starts just above it.
 * - Given an origin near a side of the area, the surface stays inside the area.
 * - Given an origin near the bottom of what is visible, the surface rises to stay in view, and its
 *   height is capped at the visible part of the scroll area.
 * - Given an area scrolled partly out of view, the surface stays below the scroll area's top.
 * - Folded, the surface is clipped to its origin's box with the origin's corner; artwork starts
 *   on its preview, moved and scaled from its resting box.
 */
import { describe, expect, it } from "vitest";
import {
  UNFOLD_LIFT,
  UNFOLD_VIEWPORT_MARGIN,
  foldedClip,
  previewTransform,
  unfoldPlacement,
  type Rect,
} from "../src/components/overlays/unfold-surface/unfold-geometry";

const rect = (left: number, top: number, width: number, height: number): Rect => ({
  left,
  top,
  width,
  height,
  right: left + width,
  bottom: top + height,
});

const AREA = rect(0, 0, 900, 1200);
const VIEWPORT = { top: 0, bottom: 700 };
const SIZE = { width: 300, height: 240 };

describe("an unfolding surface's resting place", () => {
  it("is centred on its origin and starts just above it", () => {
    const origin = rect(420, 200, 56, 56);
    const placed = unfoldPlacement({ area: AREA, viewport: VIEWPORT, origin, ...SIZE });
    expect(placed.left + SIZE.width / 2).toBe(origin.left + origin.width / 2);
    expect(placed.top).toBe(origin.top - UNFOLD_LIFT);
  });

  it("stays inside the area beside an origin at its edge", () => {
    const left = unfoldPlacement({
      area: AREA,
      viewport: VIEWPORT,
      origin: rect(4, 200, 56, 56),
      ...SIZE,
    });
    const right = unfoldPlacement({
      area: AREA,
      viewport: VIEWPORT,
      origin: rect(840, 200, 56, 56),
      ...SIZE,
    });
    expect(left.left).toBe(0);
    expect(right.left + SIZE.width).toBe(AREA.width);
  });

  it("rises to stay in view near the bottom, and is no taller than what is visible", () => {
    const placed = unfoldPlacement({
      area: AREA,
      viewport: VIEWPORT,
      origin: rect(420, 660, 56, 56),
      ...SIZE,
    });
    expect(placed.top + SIZE.height).toBe(VIEWPORT.bottom - UNFOLD_VIEWPORT_MARGIN);
    expect(placed.maxHeight).toBe(VIEWPORT.bottom - VIEWPORT.top - 2 * UNFOLD_VIEWPORT_MARGIN);
  });

  it("stays below the top of the scroll area when the area has scrolled up", () => {
    const scrolled = rect(0, -500, 900, 1200);
    const placed = unfoldPlacement({
      area: scrolled,
      viewport: VIEWPORT,
      origin: rect(420, -40, 56, 56),
      ...SIZE,
    });
    expect(scrolled.top + placed.top).toBe(VIEWPORT.top + UNFOLD_VIEWPORT_MARGIN);
  });
});

describe("the folded endpoints", () => {
  it("clip the surface to its origin's box, with the origin's corner", () => {
    expect(foldedClip(rect(100, 50, 300, 300), rect(150, 80, 56, 56), "12px")).toBe(
      "inset(30px 194px 214px 50px round 12px)",
    );
  });

  it("put artwork on its preview, moved from its corner and scaled to the preview's width", () => {
    expect(previewTransform(rect(160, 90, 20, 20), rect(120, 300, 56, 56))).toBe(
      `translate(40px, -210px) scale(${20 / 56})`,
    );
  });
});
