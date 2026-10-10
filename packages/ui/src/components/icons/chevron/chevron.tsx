/**
 * The collapse indicator: a `>` chevron that rotates 90 degrees to point down when its section is
 * open. Every collapsible draws this one — thinking blocks, tool cards, sub-session cards, sidebar
 * groups, trace trees — rather than a solid triangle character, so an open section looks the same
 * wherever it is.
 *
 * It is a component rather than a registry entry because the rotation is part of the mark, and
 * this file is where the de-slop rules let a transform transition live. Like the other marks it
 * is drawn in every icon set (`GlyphMark`), each set's drawing pointing right, so the rotation
 * turns whichever drawing the theme shows.
 */
import { GlyphMark } from "../glyph-icon/glyph-sets";
import { ChevronDown } from "../marks/marks";

export function Chevron({
  open,
  size = 14,
  className = "",
}: {
  open: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <GlyphMark
      mark="chevron"
      grid={24}
      size={size}
      className={`block shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""} ${className}`}
    >
      <path d="M9 5l7 7-7 7" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
    </GlyphMark>
  );
}

/**
 * The caret of a vertical fold: it points down while what it folds away is hidden and turns over
 * to point up once it shows — the sidebar's page-nav toggle, a slim bar under the rows it folds.
 * It is the form control's fixed-grid caret (`ChevronDown`), turned here because this is the file
 * where a transform may transition.
 */
export function ChevronFlip({
  up,
  size = 12,
  className = "",
}: {
  /** What the toggle folds is showing: the caret points up, the way it will fold. */
  up: boolean;
  size?: number;
  className?: string;
}) {
  return (
    <ChevronDown
      size={size}
      className={`transition-transform duration-200 ${up ? "rotate-180" : ""} ${className}`}
    />
  );
}
