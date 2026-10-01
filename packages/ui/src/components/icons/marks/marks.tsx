/**
 * Single-purpose marks drawn as components rather than registry paths: each fixes its own grid,
 * stroke or default size, and the form-control caret and the close cross are drawn on grids
 * smaller than the 24x24 line family — two-stroke marks alias badly when their grid and their
 * render size disagree. The rotating collapse chevron is a different glyph and lives in
 * `chevron.tsx`.
 *
 * Each mark is drawn in every icon set, like a registry glyph (`GlyphMark`, the `ui-glyph` hook):
 * the line drawing written here on the mark's own grid, and the Octicon and the pixel drawing
 * its key (`MarkName`) names in the sets.
 */
import { GlyphMark } from "../glyph-icon/glyph-sets";
import { ICONS } from "../icons";

/** The downward caret on a select, an option menu or a dropdown trigger. Colour follows currentColor. */
export function ChevronDown({ size = 12, className = "" }: { size?: number; className?: string }) {
  return (
    <GlyphMark mark="caret" grid={12} size={size} className={`shrink-0 ${className}`}>
      <path d="M3 4.5l3 3 3-3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </GlyphMark>
  );
}

/** The selected row's checkmark in a menu. */
export function CheckIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <GlyphMark mark="check" grid={24} size={size} className={`shrink-0 ${className}`}>
      <path d="M5 12l4 4L19 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </GlyphMark>
  );
}

/** The "add" plus of create buttons and new-row affordances: `ICONS.plus` at its own stroke. */
export function PlusIcon({
  size = 14,
  strokeWidth = 1.7,
  className = "",
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <GlyphMark mark="plus" grid={24} size={size} className={`shrink-0 ${className}`}>
      <path d={ICONS.plus} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </GlyphMark>
  );
}

/** A tray with a down arrow, for export and download affordances. */
export function DownloadIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <GlyphMark mark="download" grid={24} size={size} className={`shrink-0 ${className}`}>
      <path
        d="M12 4v11m0 0l-5-5m5 5l5-5M4 20h16"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlyphMark>
  );
}

/** A tray with an up arrow, for import and upload affordances. */
export function UploadIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <GlyphMark mark="upload" grid={24} size={size} className={`shrink-0 ${className}`}>
      <path
        d="M12 15V4m0 0L7 9m5-5l5 5M4 20h16"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </GlyphMark>
  );
}

/**
 * The close cross. Drawn on a 14x14 grid at stroke 1.5 rather than the 24x24 icon grid: a
 * two-stroke mark aliases badly when its grid and its render size disagree.
 */
export function CloseIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <GlyphMark mark="close" grid={14} size={size} className={`block shrink-0 ${className}`}>
      <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
    </GlyphMark>
  );
}
