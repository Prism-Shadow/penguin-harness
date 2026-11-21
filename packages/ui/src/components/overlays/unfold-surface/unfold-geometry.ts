/**
 * Where a surface that unfolds from its trigger rests, and the two endpoints its motion runs
 * between, as plain arithmetic on viewport rectangles (unfold-surface.tsx measures them).
 *
 * - The surface sits inside its area (the positioned box it is laid out in, a grid's region) and
 *   inside the visible part of the scroll area around it, a small margin off that area's edges.
 *   It is centred on its origin across, clamped to the area's sides, and starts just above the
 *   origin's top, clamped so its bottom stays in view. Its height is capped at what is visible,
 *   so neither a last-row trigger nor a long surface moves the page under it.
 * - Folded, the surface is clipped to the origin's box with the origin's own corner radius: an
 *   `inset()` measured from the surface's resting box.
 * - A piece of artwork that has a preview inside the origin starts on that preview: translated
 *   and scaled from its resting box, with the transform's origin at its top-left corner.
 */

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** The gap kept between the surface and the edges of the visible scroll area, in px. */
export const UNFOLD_VIEWPORT_MARGIN = 8;
/** How far above its origin's top the surface starts, in px. */
export const UNFOLD_LIFT = 12;

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));

/** The surface's resting place, relative to its area's padding box, and its height cap. */
export function unfoldPlacement({
  area,
  viewport,
  origin,
  width,
  height,
}: {
  /** The area's padding box, in viewport coordinates. */
  area: Rect;
  /** The visible part of the scroll area, in viewport coordinates. */
  viewport: Pick<Rect, "top" | "bottom">;
  /** The origin's box, in viewport coordinates. */
  origin: Rect;
  /** The surface's laid-out size, in px. */
  width: number;
  height: number;
}): { left: number; top: number; maxHeight: number } {
  const top = Math.max(area.top, viewport.top + UNFOLD_VIEWPORT_MARGIN);
  const bottom = viewport.bottom - UNFOLD_VIEWPORT_MARGIN;
  const x = clamp(origin.left + origin.width / 2 - width / 2, area.left, area.right - width);
  const y = clamp(origin.top - UNFOLD_LIFT, top, bottom - Math.min(height, bottom - top));
  return { left: x - area.left, top: y - area.top, maxHeight: Math.max(0, bottom - top) };
}

/** The folded clip: the surface's resting box cut down to the origin's box, with its corner. */
export function foldedClip(surface: Rect, origin: Rect, radius: string): string {
  return `inset(${origin.top - surface.top}px ${surface.right - origin.right}px ${
    surface.bottom - origin.bottom
  }px ${origin.left - surface.left}px round ${radius || "0px"})`;
}

/** The transform that puts artwork resting at `rest` onto its preview at `preview`. */
export function previewTransform(preview: Rect, rest: Rect): string {
  return `translate(${preview.left - rest.left}px, ${preview.top - rest.top}px) scale(${
    preview.width / rest.width
  })`;
}
