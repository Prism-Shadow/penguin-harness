/**
 * canvas-view.ts unit tests: the zoom range, a wheel tick's factor, the anchored zoom that
 * keeps the point under the cursor fixed, panning, the clamp that keeps the drawing reachable,
 * and the fit a chart opens at.
 */
import { describe, expect, it } from "vitest";
import {
  IDENTITY_VIEW,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  clampView,
  clampZoom,
  fitView,
  panBy,
  viewTransform,
  wheelZoomFactor,
  zoomAt,
} from "../src/features/company/canvas-view";
import type { CanvasView } from "../src/features/company/canvas-view";

/** Where a point of the drawing lands in the frame under a view — the inverse of what zoomAt has to preserve. */
const project = (view: CanvasView, x: number, y: number) => ({
  x: view.x + x * view.scale,
  y: view.y + y * view.scale,
});

describe("clampZoom", () => {
  it("keeps a scale inside the range and treats a non-number as 100%", () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(50)).toBe(ZOOM_MAX);
    expect(clampZoom(0.85)).toBe(0.85);
    expect(clampZoom(Number.NaN)).toBe(1);
  });
});

describe("wheelZoomFactor", () => {
  it("zooms in scrolling up and out scrolling down, by a tenth per notch", () => {
    expect(wheelZoomFactor(-100)).toBeCloseTo(1.1, 10);
    expect(wheelZoomFactor(100)).toBeCloseTo(1 / 1.1, 10);
    expect(wheelZoomFactor(0)).toBe(1);
    expect(wheelZoomFactor(Number.NaN)).toBe(1);
  });

  it("is smooth for a trackpad's small deltas and never jumps for an outsized one", () => {
    const small = wheelZoomFactor(-10);
    expect(small).toBeGreaterThan(1);
    expect(small).toBeLessThan(1.02);
    // A page-mode wheel reports a whole page per notch; the tick is capped at one notch.
    expect(wheelZoomFactor(-1000)).toBeCloseTo(wheelZoomFactor(-100), 10);
    expect(wheelZoomFactor(-1, 2)).toBeCloseTo(wheelZoomFactor(-100), 10);
    // Line mode (Firefox): three lines is a notch's worth, but less than a full one.
    expect(wheelZoomFactor(-3, 1)).toBeGreaterThan(1);
    expect(wheelZoomFactor(-3, 1)).toBeLessThan(wheelZoomFactor(-100));
  });
});

describe("zoomAt", () => {
  const view: CanvasView = { x: -120, y: 40, scale: 0.8 };

  it("keeps the drawing point under the pointer under it, zooming in and out", () => {
    for (const factor of [ZOOM_STEP, 1 / ZOOM_STEP, 1.37]) {
      const pointer = { x: 300, y: 220 };
      // The drawing point currently under the pointer, in drawing coordinates.
      const dx = (pointer.x - view.x) / view.scale;
      const dy = (pointer.y - view.y) / view.scale;
      const next = zoomAt(view, pointer, factor);
      expect(next.scale).toBeCloseTo(view.scale * factor, 10);
      expect(project(next, dx, dy).x).toBeCloseTo(pointer.x, 8);
      expect(project(next, dx, dy).y).toBeCloseTo(pointer.y, 8);
    }
  });

  it("anchors at the frame's origin as readily as at a point inside it", () => {
    const next = zoomAt(view, { x: 0, y: 0 }, 2);
    expect(next).toEqual({ x: -240, y: 80, scale: 1.6 });
  });

  it("stops at the range's ends and translates by the factor the clamp allowed, not the asked one", () => {
    const atMax = zoomAt({ x: 10, y: 10, scale: ZOOM_MAX }, { x: 100, y: 100 }, 4);
    expect(atMax).toEqual({ x: 10, y: 10, scale: ZOOM_MAX });
    const toMax = zoomAt({ x: 0, y: 0, scale: 1 }, { x: 100, y: 0 }, 10);
    expect(toMax.scale).toBe(ZOOM_MAX);
    // The point at drawing x = 100 stays at frame x = 100 even though the factor was cut.
    expect(project(toMax, 100, 0).x).toBeCloseTo(100, 8);
    const atMin = zoomAt({ x: 5, y: 5, scale: ZOOM_MIN }, { x: 0, y: 0 }, 0.5);
    expect(atMin).toEqual({ x: 5, y: 5, scale: ZOOM_MIN });
  });
});

describe("panBy", () => {
  it("adds the pointer delta to the translation and leaves the scale alone", () => {
    expect(panBy({ x: 10, y: -5, scale: 0.5 }, 30, -12)).toEqual({ x: 40, y: -17, scale: 0.5 });
  });
});

describe("clampView", () => {
  const frame = { width: 1000, height: 600 };
  const drawing = { width: 2000, height: 1200 };

  it("leaves a view that has the frame's centre on the drawing untouched", () => {
    const view = { x: -400, y: -200, scale: 1 };
    expect(clampView(view, frame, drawing)).toEqual(view);
  });

  it("stops a pan where the drawing's far edge reaches the frame's centre", () => {
    // Dragged right until the drawing's left edge is at the centre, and no further.
    expect(clampView({ x: 9000, y: 0, scale: 1 }, frame, drawing).x).toBe(frame.width / 2);
    // ...and left until its right edge is there.
    expect(clampView({ x: -9000, y: 0, scale: 1 }, frame, drawing).x).toBe(
      frame.width / 2 - drawing.width,
    );
    // The reach follows the scale: a shrunk drawing may travel less far.
    expect(clampView({ x: 0, y: -9000, scale: 0.5 }, frame, drawing).y).toBe(
      frame.height / 2 - drawing.height * 0.5,
    );
    expect(clampView({ x: 0, y: 9000, scale: 0.5 }, frame, drawing).y).toBe(frame.height / 2);
  });

  it("lets a drawing larger than the frame still reach both of its own edges", () => {
    // The right edge brought to the frame's right edge, which a centre-on-drawing rule allows.
    const showRight = { x: frame.width - drawing.width, y: 0, scale: 1 };
    expect(clampView(showRight, frame, drawing).x).toBe(showRight.x);
    expect(clampView({ x: 0, y: 0, scale: 1 }, frame, drawing).x).toBe(0);
  });

  it("clamps the scale too, so a view can only ever be handed on valid", () => {
    expect(clampView({ x: 0, y: 0, scale: 99 }, frame, drawing).scale).toBe(ZOOM_MAX);
  });
});

describe("fitView", () => {
  it("centres a drawing smaller than the frame without enlarging it", () => {
    expect(fitView({ width: 1000, height: 600 }, { width: 400, height: 200 })).toEqual({
      x: 300,
      y: 200,
      scale: 1,
    });
  });

  it("shrinks by the tighter of the two axes and centres what is left over", () => {
    // Width wants 0.5, height wants 0.25: the height decides, and the width is centred.
    const view = fitView({ width: 1000, height: 300 }, { width: 2000, height: 1200 });
    expect(view.scale).toBe(0.25);
    expect(view.x).toBe((1000 - 2000 * 0.25) / 2);
    expect(view.y).toBe(0);
  });

  it("never shrinks past the zoom range's floor", () => {
    expect(fitView({ width: 100, height: 100 }, { width: 10_000, height: 10_000 }).scale).toBe(
      ZOOM_MIN,
    );
  });

  it("is the identity view while the frame is unmeasured or the drawing empty", () => {
    expect(fitView({ width: 0, height: 0 }, { width: 400, height: 200 })).toBe(IDENTITY_VIEW);
    expect(fitView({ width: 1000, height: 600 }, { width: 0, height: 0 })).toBe(IDENTITY_VIEW);
  });
});

describe("viewTransform", () => {
  it("translates before it scales, which is the order the arithmetic assumes", () => {
    expect(viewTransform({ x: 12, y: -4, scale: 0.75 })).toBe("translate(12px, -4px) scale(0.75)");
  });
});
