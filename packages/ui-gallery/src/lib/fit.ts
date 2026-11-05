/**
 * Fitting something laid out at a fixed natural width — the framed app at its window width, a
 * phone frame — into the room a page column has: it lays out at its natural width and the result
 * is scaled down, never up. Pure, so the rule is unit-tested; chrome/fit.tsx measures and
 * applies it.
 */

/**
 * The factor that fits `natural` px into `available` px. Never above 1: a narrow column shrinks
 * the frame, a wide one centres it at its natural size rather than blowing it up. A width not
 * measured yet (0) reads as no scaling, so the first paint is the frame at rest.
 */
export function fitScale(natural: number, available: number): number {
  if (!(natural > 0) || !(available > 0)) return 1;
  return Math.min(1, available / natural);
}

/** The height the fitted box takes on the page: the frame's own height at the scale. */
export function fittedHeight(height: number, scale: number): number {
  return Math.ceil(height * scale);
}
