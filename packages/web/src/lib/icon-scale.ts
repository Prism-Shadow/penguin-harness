/**
 * Icon sizes and icon-to-text gaps, named by the role the mark plays rather than by a number.
 *
 * Every line icon in the app is drawn on a 24x24 grid at `strokeWidth` 1.7 and rendered through
 * `components/ui/glyph-icon.tsx`, so the only thing a call site chooses is how big the box is —
 * and structurally equivalent places must choose the same. Picking a rung by role is what keeps
 * two list rows, or two menu rows, from drifting a pixel apart.
 *
 * The two exceptions to the 24x24 grid are deliberate and stay: `ChevronDown` is drawn on a
 * 12x12 grid at 1.5, and the close cross on 14x14 at 1.5 — both are two-stroke marks whose
 * geometry is legible only when the grid matches the render size. Charts, sparklines, the
 * topology view and the login background draw their own geometry and are outside this scale.
 */

export const ICON_SIZE = {
  /** A glyph sitting inline with body or secondary text: stat chips, banner leads, buttons with a label, menu rows. The GlyphIcon default. */
  inlineGlyph: 13,
  /** The leading mark of a list row — a session row's agent avatar, a trace row's. */
  rowLead: 14,
  /** A glyph alone inside a square icon button, where it has no text to sit against and needs the extra weight. */
  iconButton: 15,
  /** A group header's leading glyph (a folder, a new-chat pencil). */
  groupHeaderGlyph: 15,
  /** A group header's trailing action buttons, all of which must optically line up with each other. */
  groupHeaderAction: 16,
  /** Sidebar navigation rows and the collapsed rail: one rung up from a list row, because a nav entry is the row. */
  navRow: 16,
  /**
   * A group header's leading avatar. One rung above `groupHeaderGlyph` on purpose: an avatar
   * tile fills its box edge to edge while a line glyph only draws inside it, so matching their
   * numbers would make the avatar read as the smaller of the two.
   */
  groupHeaderAvatar: 18,
  /** A mark that anchors a whole block rather than a line: the mobile top bar, a confirm dialog's tinted disc. */
  sectionMark: 18,
  /** The rotating collapse chevron. */
  chevron: 14,
  /** The collapse chevron in a dense row (an 11px folder row, a banner). */
  chevronDense: 12,
  /** The downward caret on a form control's trigger. */
  caret: 12,
  /** The downward caret on a dense trigger — the composer's 8px-tall pill buttons. */
  caretDense: 10,
} as const;

/**
 * Horizontal gap between an icon and the text it leads. The rungs track text size: a denser row
 * needs a tighter gap for the pair to read as one unit.
 */
export const ICON_GAP = {
  /** A glyph welded to a number — stat chips, composer chips, mono readouts. */
  tight: "gap-1",
  /** A list row: a leading mark, then a title that may truncate. */
  row: "gap-1.5",
  /** A menu row, a nav row, a banner: the icon leads, the label is the content. */
  menu: "gap-2",
  /** A card row, where the leading mark is an avatar or an illustration rather than a glyph. */
  card: "gap-3",
} as const;
