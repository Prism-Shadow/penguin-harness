/**
 * The navigation column's width bounds, as numbers (node-testable). They hold the width a reader
 * drags the column to; the theme's own width, which the column has until it is first dragged,
 * is a class and follows the theme's spacing unit and the text size instead.
 *
 * Pixels, not rem: the bounds are compared with pointer positions and stored as the reader left
 * them, and the root font size is the reader's own setting, so a rem bound would move under a
 * stored width every time the text size changed.
 */

/** Narrowest the column may be dragged: the menu rows and a conversation title still read. */
export const NAV_MIN_WIDTH = 240;

/** Widest the column may be dragged on any window. */
export const NAV_MAX_WIDTH = 480;

/** The share of the window the column may take at most, so the page beside it keeps its room. */
const NAV_MAX_SHARE = 0.4;

/**
 * The widest the column may be on a window this wide: the hard ceiling, or the window's share
 * when that is less, never under the minimum. An unknown window (0, no window to measure) takes
 * the hard ceiling.
 */
export function navMaxWidth(windowWidth: number): number {
  if (windowWidth <= 0) return NAV_MAX_WIDTH;
  return Math.max(NAV_MIN_WIDTH, Math.min(NAV_MAX_WIDTH, Math.round(windowWidth * NAV_MAX_SHARE)));
}

/** A width brought within the bounds of a window this wide, in whole pixels. */
export function clampNavWidth(width: number, windowWidth: number): number {
  const asked = Number.isFinite(width) ? Math.round(width) : NAV_MIN_WIDTH;
  return Math.min(navMaxWidth(windowWidth), Math.max(NAV_MIN_WIDTH, asked));
}
