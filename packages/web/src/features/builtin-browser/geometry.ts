/**
 * Where each built-in browser page sits on screen, as plain rectangle arithmetic.
 *
 * A `<webview>` reloads its page whenever it is moved in the DOM, so the pages never live
 * inside the dock. They sit in one fixed layer (browser-layer.tsx) and are laid OVER the dock's
 * viewport slot by coordinates: the tab on screen covers the part of the slot its clipping
 * ancestors leave visible, and every other page is parked far off-screen at a real size, so a
 * page the agent works in while the dock is closed keeps a desktop layout.
 *
 * Each page is two boxes: a clipping FRAME at the visible part of the slot, and the VIEW inside
 * it at the slot's full size. While a dock slides open, the frame grows with it and the page
 * slides in whole, instead of being re-laid-out at every intermediate width.
 */

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

/** Where parked pages go: far enough left that no screen reaches them. */
export const PARK_LEFT = -20000;

/** The size of a page that has never been on screen: a common desktop viewport. */
export const DEFAULT_PARK_SIZE: Size = { width: 1280, height: 800 };

/** One page's boxes for this frame. `view` is relative to `frame`. */
export interface Placement {
  shown: boolean;
  frame: Rect;
  view: Rect;
}

/** The overlap of two rectangles, or null when they do not overlap. */
export function intersect(a: Rect, b: Rect): Rect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}

/**
 * Whole-pixel edges. Rounding the edges (not the sizes) keeps two rects that share an edge
 * sharing it after rounding, so the frame never opens a one-pixel seam against the slot.
 */
export function snapRect(rect: Rect): Rect {
  const left = Math.round(rect.left);
  const top = Math.round(rect.top);
  return {
    left,
    top,
    width: Math.round(rect.left + rect.width) - left,
    height: Math.round(rect.top + rect.height) - top,
  };
}

/** A parked page: off-screen, at the given size. */
export function parkedPlacement(size: Size): Placement {
  return {
    shown: false,
    frame: { left: PARK_LEFT, top: 0, width: size.width, height: size.height },
    view: { left: 0, top: 0, width: size.width, height: size.height },
  };
}

/**
 * The placement of the page on screen: over `slot`, clipped by every ancestor box in `clips`
 * (the dock's own clipping window, the app's main area). Parked at `parkSize` when there is
 * no slot or nothing of it is visible.
 */
export function slotPlacement(
  slot: Rect | null,
  clips: readonly Rect[],
  parkSize: Size,
): Placement {
  if (slot === null) return parkedPlacement(parkSize);
  const whole = snapRect(slot);
  let visible: Rect | null = whole;
  for (const clip of clips) {
    if (visible === null) break;
    visible = intersect(visible, snapRect(clip));
  }
  if (visible === null || whole.width <= 0 || whole.height <= 0) return parkedPlacement(parkSize);
  return {
    shown: true,
    frame: visible,
    view: {
      left: whole.left - visible.left,
      top: whole.top - visible.top,
      width: whole.width,
      height: whole.height,
    },
  };
}

/** The size a page parks at after it was on screen: the size it was shown at. */
export function shownSize(placement: Placement): Size | null {
  return placement.shown ? { width: placement.view.width, height: placement.view.height } : null;
}

function sameRect(a: Rect, b: Rect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** Whether two placements need no DOM write between them. */
export function samePlacement(a: Placement | undefined, b: Placement): boolean {
  return (
    a !== undefined && a.shown === b.shown && sameRect(a.frame, b.frame) && sameRect(a.view, b.view)
  );
}
