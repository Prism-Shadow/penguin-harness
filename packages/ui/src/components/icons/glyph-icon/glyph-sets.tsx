/**
 * The anatomy of the `ui-glyph` hook (hooks.ts), shared by its two hosts: `GlyphIcon` for the
 * registry's glyphs and `GlyphMark` for the marks drawn as components. Inside the host's `<svg>`
 * a glyph is drawn three times, one per icon set, and the theme's CSS shows its own:
 *
 * - `<g data-set="line">` — the host's stroke drawing on its own grid (24x24 for the registry,
 *   the mark's grid for a mark), which inherits the host's stroke;
 * - `<svg data-set="octicons">` — the Octicon, a 16-grid filled path scaled to the whole box;
 * - `<svg data-set="pixel">` — the 16x16 pixel drawing on crisp edges, laid out on whole pixels.
 *
 * Nothing here knows which theme is active, and nothing is hidden by the markup itself: the
 * foundation's base rule shows the line set and hides the other two, and a theme that draws
 * another set swaps them. Three small elements per glyph, with every path string shared and the
 * pixel paths memoized by `pixelPath`, so the cost of a glyph does not grow with the themes.
 */
import type { ReactNode } from "react";
import { OCTICONS, OCTICONS_FILLED, PIXEL_ICONS, PIXEL_ICONS_FILLED, pixelPath } from "../sets";
import type { GlyphKey, MarkName } from "../sets";

/** The cells of a pixel drawing a side. */
const PIXEL_GRID = 16;

/** The smallest box, in px, the pixel drawing is laid out in at one cell to a CSS pixel. */
const PIXEL_SNAP_FROM = 13;

const round4 = (value: number) => Math.round(value * 1e4) / 1e4;

/**
 * Where the pixel drawing sits in a box of `size` px whose viewBox is `grid` units a side, in
 * those units. From 13 px up it is laid out at 16 CSS px, one cell to a pixel, centred and
 * allowed to spill past a smaller box: a pixel drawing scaled by a fraction smears each
 * one-pixel line across two. The offset is rounded to a whole pixel so the cells land on the
 * box's own pixel grid. Below 13 px no placement keeps sixteen cells whole, so the drawing
 * scales to fill the box.
 */
function pixelFrame(grid: number, size: number): { at: number; span: number } {
  if (size < PIXEL_SNAP_FROM) return { at: 0, span: grid };
  const unit = grid / size;
  return {
    at: round4(Math.round((size - PIXEL_GRID) / 2) * unit),
    span: round4(PIXEL_GRID * unit),
  };
}

/**
 * The three drawings of one glyph, for its host to place inside its `<svg>`: `children` is the
 * line drawing, and `filled` picks each set's "on" drawing where it has one (a pinned tack).
 */
export function GlyphSets({
  glyph,
  grid,
  size,
  filled = false,
  children,
}: {
  glyph: GlyphKey;
  /** The host's viewBox side, in user units. */
  grid: number;
  /** The host's rendered side, in CSS px. */
  size: number;
  filled?: boolean;
  children: ReactNode;
}) {
  const octicon = (filled ? OCTICONS_FILLED[glyph] : undefined) ?? OCTICONS[glyph];
  const pixel = (filled ? PIXEL_ICONS_FILLED[glyph] : undefined) ?? PIXEL_ICONS[glyph];
  const { at, span } = pixelFrame(grid, size);
  return (
    <>
      <g data-set="line">{children}</g>
      <svg
        data-set="octicons"
        width={grid}
        height={grid}
        viewBox="0 0 16 16"
        fill="currentColor"
        stroke="none"
      >
        <path d={octicon} />
      </svg>
      <svg
        data-set="pixel"
        x={at}
        y={at}
        width={span}
        height={span}
        viewBox="0 0 16 16"
        fill="currentColor"
        stroke="none"
        shapeRendering="crispEdges"
        overflow="visible"
      >
        <path d={pixelPath(pixel)} />
      </svg>
    </>
  );
}

/**
 * A mark drawn as a component (the caret, the check, the plus, the trays, the close cross, the
 * collapse chevron): the host `<svg>` on the mark's own grid, decorative, with the mark's line
 * drawing as `children` and its other two drawings beside it. The caller's classes carry its
 * layout and any transform.
 */
export function GlyphMark({
  mark,
  grid,
  size,
  className,
  children,
}: {
  mark: MarkName;
  /** The grid the line drawing is drawn on, a side. */
  grid: number;
  size: number;
  className: string;
  children: ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${grid} ${grid}`}
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`ui-glyph ${className}`}
    >
      <GlyphSets glyph={mark} grid={grid} size={size}>
        {children}
      </GlyphSets>
    </svg>
  );
}
