/**
 * DropOverlay: what a region shows while files are dragged over it — the feedback that letting
 * go here does something, and what.
 *
 * Two shapes. `veil` washes the whole region and centres a dashed card on it, with a title and a
 * line under it: the conversation column, where a drop attaches files to the message being
 * written. `frame` rings the region in a dashed frame and pins a label at its foot: the Files
 * panel, where the label names the folder the files will land in, and the rows under the frame
 * stay visible because a folder row is itself a target.
 *
 * Pure feedback, never a target: `pointer-events-none`, so the drag's hit test keeps seeing the
 * real element underneath (which is how a folder row can be the one the files land in), and
 * `aria-hidden` — it exists only during a pointer drag, and the accessible way in is the region's
 * own upload control. It is positioned `absolute inset-0`, so its region is its nearest
 * positioned ancestor, and it fades in once when it appears.
 */
import { ICON_SIZE } from "../../../icon-scale";
import { GlyphIcon } from "../../icons/glyph-icon/glyph-icon";

/** The card's glyph in the veil: it anchors the card on its own, larger than any row's mark. */
const VEIL_GLYPH_PX = 28;

export interface DropOverlayProps {
  /** `veil` over a whole column, `frame` around a panel whose rows stay visible. */
  variant?: "veil" | "frame";
  /** What letting go does (the veil's heading, the frame's label). */
  title: string;
  /** The veil's line under the title: what is accepted, and how. */
  description?: string;
  /** The mark leading the text, as 24×24 path data. */
  glyph: string;
}

export function DropOverlay({ variant = "veil", title, description, glyph }: DropOverlayProps) {
  if (variant === "frame") {
    return (
      <div
        aria-hidden
        className="anim-fade pointer-events-none absolute inset-0 z-20 flex items-end justify-center p-3"
      >
        <div className="absolute inset-1 rounded-lg border-2 border-dashed border-fg-subtle bg-canvas/40" />
        <div className="relative flex items-center gap-2 rounded-md border border-line-emphasis bg-surface/95 px-3 py-1.5 text-xs font-medium text-fg shadow-sm">
          <GlyphIcon d={glyph} size={ICON_SIZE.rowLead} className="text-fg-subtle" />
          <span className="truncate">{title}</span>
        </div>
      </div>
    );
  }
  return (
    <div
      aria-hidden
      className="anim-fade pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-canvas/70 p-6"
    >
      <div className="flex flex-col items-center gap-2 rounded-xl border-2 border-dashed border-fg-subtle bg-surface/80 px-10 py-8 text-center">
        <GlyphIcon d={glyph} size={VEIL_GLYPH_PX} className="text-fg-subtle" />
        <p className="text-base font-medium text-fg">{title}</p>
        {description !== undefined && <p className="text-xs text-fg-muted">{description}</p>}
      </div>
    </div>
  );
}
