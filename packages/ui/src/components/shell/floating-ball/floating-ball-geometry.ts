/**
 * The decisions behind the floating ball (floating-ball.tsx), kept free of the DOM so they are
 * unit-testable: where the ball rests on its edge, how far a drag may take it, which side a
 * release lands on, and when a release tucks it away instead.
 *
 * Coordinates are the ball's top-left corner inside its area (the region it lives in). A placement
 * is what a caller stores: the side edge it rests on, its centre's height as a ratio of the area's
 * height, and whether it is tucked. The ratio, not a pixel offset, is what survives a resize: the
 * resting point is re-derived from it and clamped into the area, and the ratio itself is only
 * rewritten by the reader moving the ball.
 */

export type FloatingBallSide = "left" | "right";

export interface FloatingBallPlacement {
  /** The side edge the ball rests on. */
  side: FloatingBallSide;
  /** The ball's centre as a ratio of the area's height, 0 (top) … 1 (bottom); clamped when placed. */
  ratio: number;
  /** Put away: a handle on `side` stands in for the ball. */
  tucked: boolean;
}

/** The region the ball lives in (px). */
export interface FloatingBallArea {
  width: number;
  height: number;
}

/** The ball's top-left corner inside its area (px). */
export interface FloatingBallPoint {
  left: number;
  top: number;
}

export interface FloatingBallMetrics {
  /** The ball's diameter (px). */
  size: number;
  /** Room kept to the side edge at rest, and to the area's top and bottom always (px). */
  inset: number;
  /** A release whose centre is within this of a side edge tucks the ball (px). */
  tuckZone: number;
}

/**
 * A 46px ball, one rung under the dock launcher's 56px: it carries no caption and floats over
 * somebody else's page, so it covers as little as it can. 16px off the edges, where a corner
 * button sits; a 12px band at each side edge, narrower than the inset, so only a deliberate push
 * past the edge tucks it.
 */
export const FLOATING_BALL_METRICS: FloatingBallMetrics = { size: 46, inset: 16, tuckZone: 12 };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The lowest and highest `top` that keep the ball inside the area with the inset; max is never below min. */
export function floatingBallBounds(
  area: FloatingBallArea,
  metrics: FloatingBallMetrics = FLOATING_BALL_METRICS,
): { min: number; max: number } {
  const min = metrics.inset;
  return { min, max: Math.max(min, area.height - metrics.size - metrics.inset) };
}

/** Where a placement rests: on its edge with the inset, at its ratio, clamped into the bounds. */
export function floatingBallRest(
  placement: FloatingBallPlacement,
  area: FloatingBallArea,
  metrics: FloatingBallMetrics = FLOATING_BALL_METRICS,
): FloatingBallPoint {
  const { min, max } = floatingBallBounds(area, metrics);
  const left =
    placement.side === "left"
      ? metrics.inset
      : Math.max(metrics.inset, area.width - metrics.size - metrics.inset);
  return { left, top: clamp(placement.ratio * area.height - metrics.size / 2, min, max) };
}

/**
 * Where the ball is mid-drag: `start` moved by the pointer's travel, its top held inside the
 * bounds, and its left free until the ball's centre reaches either side edge, which is as far as
 * a push past the edge goes.
 */
export function floatingBallDrag(
  start: FloatingBallPoint,
  dx: number,
  dy: number,
  area: FloatingBallArea,
  metrics: FloatingBallMetrics = FLOATING_BALL_METRICS,
): FloatingBallPoint {
  const { min, max } = floatingBallBounds(area, metrics);
  const half = metrics.size / 2;
  return {
    left: clamp(start.left + dx, -half, Math.max(-half, area.width - half)),
    top: clamp(start.top + dy, min, max),
  };
}

/** Whether a release here tucks the ball: its centre is within the tuck zone of a side edge. */
export function floatingBallInTuckZone(
  point: FloatingBallPoint,
  area: FloatingBallArea,
  metrics: FloatingBallMetrics = FLOATING_BALL_METRICS,
): boolean {
  const centre = point.left + metrics.size / 2;
  return centre < metrics.tuckZone || centre > area.width - metrics.tuckZone;
}

/**
 * What a release here stores: the side its centre is on, the ratio of its centre's height (kept
 * from `previous` in an area with no height to measure against), and tucked when the release was
 * in the tuck zone.
 */
export function floatingBallDrop(
  point: FloatingBallPoint,
  area: FloatingBallArea,
  previous: FloatingBallPlacement,
  metrics: FloatingBallMetrics = FLOATING_BALL_METRICS,
): FloatingBallPlacement {
  const { min, max } = floatingBallBounds(area, metrics);
  const centreX = point.left + metrics.size / 2;
  const centreY = clamp(point.top, min, max) + metrics.size / 2;
  return {
    side: centreX < area.width / 2 ? "left" : "right",
    ratio: area.height > 0 ? clamp(centreY / area.height, 0, 1) : previous.ratio,
    tucked: floatingBallInTuckZone(point, area, metrics),
  };
}

/**
 * A stored value read back as a placement, or null when it is not one: anything but an object,
 * a side other than left or right, a ratio that is not a finite number, or a `tucked` present
 * but not a boolean. The ratio is clamped into [0, 1]; an absent `tucked` is false.
 */
export function coerceFloatingBallPlacement(value: unknown): FloatingBallPlacement | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { side, ratio, tucked } = value as Record<string, unknown>;
  if (side !== "left" && side !== "right") return null;
  if (typeof ratio !== "number" || !Number.isFinite(ratio)) return null;
  if (tucked !== undefined && typeof tucked !== "boolean") return null;
  return { side, ratio: clamp(ratio, 0, 1), tucked: tucked === true };
}
