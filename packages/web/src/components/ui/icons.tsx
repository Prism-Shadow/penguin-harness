/**
 * Shared single-path icons and the dialog close button, replacing SVGs that were
 * inlined identically at many call sites. Note `chevron.tsx` is a *different*
 * glyph (the rotating right-caret used by collapsibles) and stays separate.
 */
import type { ButtonHTMLAttributes } from "react";
import { S } from "../../lib/strings";
import { AGENT_GROUP_ICON } from "./group-list";

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

/** Download glyph (tray with a down arrow), used by export/download affordances. */
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

/** Upload glyph (tray with an up arrow), used by import/upload affordances. */
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
      <CloseIcon />
    </button>
  );
}

/** Info circle: the app's 9-radius status circle with a bar and a dot inside it. */
export const INFO_ICON = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5m0-8h.01";

/** Chat bubble: the messaging binding's channel-neutral mark (dock panel tab). */
export const MESSAGING_ICON = "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z";

/**
 * Paper plane: remote control — the session-row mark for a Session that is relaying through
 * a messaging channel, and the row menu's action that sets one up. One shape for every
 * channel — shape alone is not the carrier, so the row pairs it with the channel's name in
 * a tooltip and in sr-only text, and the menu entry is labelled.
 */
export const MESSAGING_RELAY_ICON = "M22 2 11 13M22 2l-7 20-4-9-9-4z";

/** Standard gear (lucide settings): full tooth outline + center circle, crisp and undistorted at 16px. */
export const GEAR_ICON =
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2zM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z";

/**
 * Page-nav glyphs (moved from sidebar.tsx: the sidebar nav, the collapsed rail in
 * app-layout.tsx, and cross-page jump actions — e.g. the chat info dropdown's "view
 * trace" — share them; living here keeps chat-page free of a sidebar import cycle,
 * sidebar.tsx importing DRAFT_SESSION_ID from chat-page).
 */
export const NAV_ICONS = {
  agents: AGENT_GROUP_ICON,
  /** Skill library (an open book: two pages + spine). */
  skills: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z",
  models: "M7 7h10v10H7zM4 10h3m10 0h3M4 14h3m10 0h3M10 4v3m4-3v3m-4 10v3m4-3v3",
  /** Machines (two stacked server units, each with its own status lamp). */
  machines: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01",
  usage: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  traces: "M4 6h16M4 12h10M4 18h13",
  /** Benchmark center (a trophy: cup + two handles + base). */
  benchmark:
    "M7 4h10v5a5 5 0 0 1-10 0V4zM7 5H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3M12 14v4m-4 0h8",
  /** Terminal (a `>_` prompt in a window frame). */
  terminal: "M3 5h18v14H3zM7 9l3 3-3 3M13 15h4",
} as const;
