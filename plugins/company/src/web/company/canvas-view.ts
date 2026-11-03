/**
 * The org chart canvas's view arithmetic (pure, unit tested). The drawing is painted once at
 * its natural size and placed by a single transform, so a view is three numbers: where the
 * drawing's top-left corner sits inside the frame, and the scale it is drawn at (the layer's
 * `transform-origin` is `0 0`, which is what makes the two compose in this order).
 *
 * Zooming is anchored: whatever sits under the pointer must still sit under it afterwards,
 * which is `translate' = pointer − (pointer − translate) · factor`. Panning adds a pointer
 * delta to the translation. Both go through `clampView`, which keeps the frame's centre on
 * the drawing — a canvas whose content has been flicked off the window gives the reader
 * nothing to aim at, and "fit" would be the only way back.
 */

/** Where the drawing sits in the frame (px, from the frame's top-left corner) and what it is scaled by. */
export interface CanvasView {
  x: number;
  y: number;
  scale: number;
}

/** A box the view arithmetic measures against: the frame's inside, or the drawing's natural size. */
export interface CanvasSize {
  width: number;
  height: number;
}

export const ZOOM_MIN = 0.2;
export const ZOOM_MAX = 2;
/** One −/+ press. Multiplicative, so a press covers the same visual ground at 30% as at 150%. */
export const ZOOM_STEP = 1.2;

/** The drawing at its natural size in the frame's top-left corner — the view before anything is measured. */
export const IDENTITY_VIEW: CanvasView = { x: 0, y: 0, scale: 1 };

export function clampZoom(scale: number): number {
  if (!Number.isFinite(scale)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
}

/** A wheel event's line and page modes in pixels (Firefox reports lines, a few setups whole pages). */
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 100;
/** The largest tick a single event may zoom by: one wheel notch, whatever the source claims to have moved. */
const WHEEL_MAX_PX = 100;

/**
 * The zoom factor of one wheel tick: smooth and multiplicative, so a mouse's few large
 * deltas and a trackpad's stream of small ones land on the same curve (a notch is ~100px
 * and a tenth of zoom). Scrolling up — a negative delta — zooms in, as every canvas does.
 */
export function wheelZoomFactor(deltaY: number, deltaMode = 0): number {
  if (!Number.isFinite(deltaY) || deltaY === 0) return 1;
  const px = deltaY * (deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1);
  const tick = Math.max(-WHEEL_MAX_PX, Math.min(WHEEL_MAX_PX, px));
  return 1.1 ** (-tick / 100);
}

/**
 * Zoom by `factor` around a point given in frame coordinates, keeping what is under that
 * point where it is. The clamp is applied to the scale first and the translation follows the
 * factor that survived it, so a wheel at either end of the range moves nothing at all rather
 * than sliding the drawing sideways.
 */
export function zoomAt(
  view: CanvasView,
  pointer: { x: number; y: number },
  factor: number,
): CanvasView {
  const from = clampZoom(view.scale);
  const scale = clampZoom(from * factor);
  const applied = scale / from;
  return {
    x: pointer.x - (pointer.x - view.x) * applied,
    y: pointer.y - (pointer.y - view.y) * applied,
    scale,
  };
}

/** Move the drawing by a pointer delta; the scale is untouched. */
export function panBy(view: CanvasView, dx: number, dy: number): CanvasView {
  return { x: view.x + dx, y: view.y + dy, scale: view.scale };
}

/**
 * Keep the frame's centre inside the drawing: every point of the tree can be brought to the
 * middle of the frame, and nothing further. One rule holds at both ends of the zoom range —
 * a drawing wider than the frame still reaches each of its own edges, and a small one cannot
 * be flicked into a corner and lost. A rule counting overlapping pixels instead allows
 * exactly that, since the corner a flick leaves in the frame is the tree's empty margin: the
 * box is still technically on screen and there is nothing on it to see.
 */
export function clampView(view: CanvasView, frame: CanvasSize, drawing: CanvasSize): CanvasView {
  const scale = clampZoom(view.scale);
  const axis = (value: number, frameSize: number, drawingSize: number): number => {
    const centre = frameSize / 2;
    return Math.min(centre, Math.max(centre - drawingSize * scale, value));
  };
  return {
    x: axis(view.x, frame.width, drawing.width),
    y: axis(view.y, frame.height, drawing.height),
    scale,
  };
}

/**
 * The view a chart opens at: the whole drawing centred in the frame, shrunk to fit but never
 * enlarged past its natural size — a two-person chart blown up to fill a monitor reads as a
 * rendering fault, not as a fit. An unmeasured frame or an empty drawing leaves the identity
 * view, which the next measurement replaces.
 */
export function fitView(frame: CanvasSize, drawing: CanvasSize): CanvasView {
  if (!(frame.width > 0) || !(frame.height > 0)) return IDENTITY_VIEW;
  if (!(drawing.width > 0) || !(drawing.height > 0)) return IDENTITY_VIEW;
  const scale = clampZoom(Math.min(1, frame.width / drawing.width, frame.height / drawing.height));
  return {
    x: (frame.width - drawing.width * scale) / 2,
    y: (frame.height - drawing.height * scale) / 2,
    scale,
  };
}

/** The CSS the drawing layer is placed by. Translation before scale, matching `zoomAt`'s arithmetic. */
export function viewTransform(view: CanvasView): string {
  return `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}
