/**
 * Pure rules of the truncated-title scroll reveal (#309): whether a clipped title
 * actually overflows, how far it must travel to bring its tail into view, how long
 * that travel should take, and which of the reveal and the `title` tooltip is the
 * one disclosing the tail (#570). Kept out of truncated.tsx so the logic is
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

/** How a clipped title hands its tail over: the scroll, the native tooltip, or neither. */
export type TitleDisclosure = "none" | "scroll" | "tooltip";

/**
 * The scroll and the `title` tooltip are alternatives, never a pair — a tooltip raised over a
 * row that is already scrolling repeats the text sliding past underneath it (#570). The scroll
 * takes the disclosure wherever it can actually run: a caller that asked for it, on text that
 * really overflows, while the keyframes are enabled. The tooltip covers everything left over —
 * callers without the reveal, and reveal rows under `prefers-reduced-motion`, where styles.css
 * disables the keyframes outright and nothing would move.
 */
export function titleDisclosure(opts: {
  overflowing: boolean;
  scrollReveal: boolean;
  reducedMotion: boolean;
}): TitleDisclosure {
  if (!opts.overflowing) return "none";
  return opts.scrollReveal && !opts.reducedMotion ? "scroll" : "tooltip";
}
