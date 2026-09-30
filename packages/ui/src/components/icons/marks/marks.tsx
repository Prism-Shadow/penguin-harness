/**
 * Single-purpose marks drawn as components rather than registry paths: each fixes its own grid,
 * stroke or default size, and the form-control caret and the close cross are drawn on grids
 * smaller than the 24x24 line family — two-stroke marks alias badly when their grid and their
 * render size disagree. The rotating collapse chevron is a different glyph and lives in
 * `chevron.tsx`.
 */
import { ICONS } from "../icons";

/** The downward caret on a select, an option menu or a dropdown trigger. Colour follows currentColor. */
export function ChevronDown({ size = 12, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d="M3 4.5l3 3 3-3" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The selected row's checkmark in a menu. */
export function CheckIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d="M5 12l4 4L19 6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path d={ICONS.plus} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** A tray with a down arrow, for export and download affordances. */
export function DownloadIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path
        d="M12 4v11m0 0l-5-5m5 5l5-5M4 20h16"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A tray with an up arrow, for import and upload affordances. */
export function UploadIcon({ size = 13, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`shrink-0 ${className}`}
    >
      <path
        d="M12 15V4m0 0L7 9m5-5l5 5M4 20h16"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The close cross. Drawn on a 14x14 grid at stroke 1.5 rather than the 24x24 icon grid: a
 * two-stroke mark aliases badly when its grid and its render size disagree.
 */
export function CloseIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      aria-hidden
      className={`block shrink-0 ${className}`}
    >
      <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}
