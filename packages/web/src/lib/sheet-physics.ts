/**
 * Gesture math for the bottom Sheet (pure functions, unit-test covered):
 * - project: projects release velocity to an inertial endpoint using the
 *   iOS scroll deceleration curve — the snap point is chosen from the
 *   projected point rather than the release point, so a quick flick can
 *   close/expand the sheet;
 * - rubberband: progressive damping past the boundary, so drag-past-edge
 *   follow amount decreases instead of hard-stopping;
 * - nearestSnap: picks the closest candidate snap point.
 */

/** Inertial projected displacement (px). velocity is in px/s; decelerationRate 0.998 ≈ typical iOS scroll feel. */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/** Overshoot damping: overshoot is the amount past the boundary (≥0), dimension is a reference size (e.g. panel height). Returns the displayed overshoot amount. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/** Picks the candidate snap point closest to position. */
export function nearestSnap(position: number, snaps: readonly number[]): number {
  let best = snaps[0]!;
  for (const s of snaps) {
    if (Math.abs(s - position) < Math.abs(best - position)) best = s;
  }
  return best;
}
