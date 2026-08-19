/**
 * Pure math of the truncated-title scroll reveal (#309): whether a clipped title
 * actually overflows, how far it must travel to bring its tail into view, and how
 * long that travel should take. Kept out of truncated.tsx so the logic is
 * unit-testable (vitest runs node-only, no DOM) — the component feeds in the live
 * scrollWidth/clientWidth and writes the results into CSS custom properties.
 */

/**
 * Subpixel rounding can report scrollWidth 1px over clientWidth on text that
 * actually fits (even monospace text can be off by 1px); treat that as "fits" so
 * neither a spurious `title` tooltip nor a 1px scroll ever appears.
 */
export const OVERFLOW_TOLERANCE_PX = 1;

/** Reading speed of the scroll: hidden pixels revealed per second (a comfortable skim pace for one sidebar row). */
export const REVEAL_SPEED_PX_PER_S = 60;

/** Duration floor: a tiny overflow finishing in under this reads as a glitch rather than a scroll. */
export const REVEAL_MIN_MS = 350;

/** Duration ceiling: an absurdly long title speeds up rather than holding the hover hostage for 10+ seconds. */
export const REVEAL_MAX_MS = 4000;

/**
 * Pixels the text must translate to reveal its clipped tail; 0 = the text fits
 * (within the subpixel tolerance) and there is nothing to reveal or tooltip.
 */
export function revealDistancePx(scrollWidth: number, clientWidth: number): number {
  const overflow = scrollWidth - clientWidth;
  return overflow > OVERFLOW_TOLERANCE_PX ? overflow : 0;
}

/**
 * Scroll duration for a reveal distance: proportional to the distance (constant
 * reading speed, so short and long titles feel the same), clamped to the
 * floor/ceiling above. 0 for "fits" — no distance, no animation.
 */
export function revealDurationMs(distancePx: number): number {
  if (distancePx <= 0) return 0;
  const proportional = (distancePx / REVEAL_SPEED_PX_PER_S) * 1000;
  return Math.round(Math.min(REVEAL_MAX_MS, Math.max(REVEAL_MIN_MS, proportional)));
}
