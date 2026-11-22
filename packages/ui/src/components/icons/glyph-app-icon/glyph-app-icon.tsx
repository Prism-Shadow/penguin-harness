/**
 * A system app's icon: its page's line glyph on the App Center's icon shape (`AppIconShape`), on
 * the neutral fill, the glyph at half the edge. `GlyphIcon` draws it, so a theme's icon set
 * redraws it as it redraws every registry glyph. It is the app's picture, so it carries
 * information and is never a decorative icon a theme may drop; it stands beside the app's name,
 * which says what it is, so it is hidden from assistive technology.
 */
import { AppIconShape, APP_ICON_PX } from "../app-icon-shape/app-icon-shape";
import { GlyphIcon } from "../glyph-icon/glyph-icon";

/** The smallest glyph the icon draws, in px: below it a line glyph stops reading. */
const MIN_GLYPH_PX = 10;

export function GlyphAppIcon({
  d,
  size = APP_ICON_PX,
  className = "",
}: {
  /** The 24×24 line path: a glyph from the registry (`ICONS`). */
  d: string;
  /** Edge of the square, in px. */
  size?: number;
  className?: string;
}) {
  return (
    <AppIconShape
      aria-hidden
      size={size}
      className={`flex items-center justify-center bg-fill-neutral text-fg ${className}`}
    >
      <GlyphIcon d={d} size={Math.max(MIN_GLYPH_PX, Math.round(size / 2))} />
    </AppIconShape>
  );
}
