/**
 * Shared single-path icons and the dialog close button, replacing SVGs that were
 * inlined identically at many call sites. Note `chevron.tsx` is a *different*
 * glyph (the rotating right-caret used by collapsibles) and stays separate.
 */
import type { ButtonHTMLAttributes } from "react";
import { S } from "../../lib/strings";

/** Downward caret on Select / OptionMenu / composer dropdown triggers. Color follows currentColor (callers add text-gray-400). */
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

/** Selected-row checkmark in the Select / OptionMenu menus. */
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

/** "Add" plus glyph used by create buttons / new-row affordances. */
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
      <path
        d="M12 5v14M5 12h14"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The X close button shared by the Modal / Drawer / Sheet headers: same glyph,
 * padding and hover treatment. Extra button props (e.g. Sheet's onPointerDown
 * guard) pass through.
 */
export function CloseButton({
  onClose,
  className = "",
  ...rest
}: { onClose: () => void; className?: string } & Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick"
>) {
  return (
    <button
      type="button"
      aria-label={S.common.close}
      onClick={onClose}
      className={`rounded-md p-1.5 text-gray-400 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300 ${className}`}
      {...rest}
    >
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" aria-hidden>
        <path d="M2 2l10 10M12 2L2 12" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}
