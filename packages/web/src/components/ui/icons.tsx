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

/**
 * Window with a bottom pane / a right pane: the two dock edges. Drawn by the chat toolbar's
 * pull-open buttons and the dock header's move-dock buttons, so one mark stands for one edge
 * everywhere.
 */
export const PANEL_BOTTOM_ICON = "M4 5h16v14H4zM4 14h16";
export const PANEL_RIGHT_ICON = "M4 5h16v14H4zM14 5v14";

/** A dashboard of four tiles: the workbench the floating launcher opens. */
export const WORKBENCH_ICON = "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z";

/**
 * Four corner brackets opening outward: the floating launcher's ball while the pointer or the
 * keyboard is on it, in place of the workbench tiles it rests on. Brackets rather than an arrow
 * or a chevron because the fan they announce opens up, left and down at once, and a mark with a
 * direction in it would name the wrong one.
 */
export const EXPAND_ICON = "M9 3H3v6M15 3h6v6M15 21h6v-6M9 21H3v-6";

/** The same four corner brackets turned inward: what the launcher ball offers while its fan stands open. */
export const COLLAPSE_ICON = "M3 9h6V3M21 9h-6V3M21 15h-6v6M3 15h6v6";

/**
 * Two robot heads, a large one above-left and a small one below-right: the subagents panel,
 * wherever the dock names it. The single robot head of `AGENT_GROUP_ICON` is the Agent itself;
 * the pair is what that Agent has going on underneath it. Reduced to antenna + head + two eye
 * dots, because the ears and the smile the single head carries fall below a pixel on the dock's
 * 13px tab strip.
 */
export const AGENTS_PAIR_ICON =
  "M7.3 4.2V2.2M3.8 4.2h7a2.2 2.2 0 0 1 2.2 2.2v5.8a2.2 2.2 0 0 1-2.2 2.2h-7a2.2 2.2 0 0 1-2.2-2.2V6.4a2.2 2.2 0 0 1 2.2-2.2zM4.6 9.2h.01M10 9.2h.01M18.6 14.8v-1.7M16.5 14.8h4.2a1.7 1.7 0 0 1 1.7 1.7v3.8a1.7 1.7 0 0 1-1.7 1.7h-4.2a1.7 1.7 0 0 1-1.7-1.7v-3.8a1.7 1.7 0 0 1 1.7-1.7zM17.3 18.4h.01M20.5 18.4h.01";

/**
 * The brain in profile — for the Memory panel, the memory-changes card and the agent cards'
 * memory count.
 *
 * A closed outline (the lobed crown, the frontal lobe at the left, the brainstem dropping from the
 * underside) and twelve gyri inside it. The gyri do not resolve individually at 13px, the smallest
 * size these three surfaces draw it at, but they are not wasted there either: they read as the
 * texture of a brain, which is what separates this from a cloud. At 18px and above each one is its
 * own mark.
 *
 * This is much the longest path in the family, and deliberately so — it is a traced profile rather
 * than a figure built from arcs, and the interior is what makes it read. Every surface draws it
 * from here: a memory mark typed out a second time is how one thing ends up with two pictures of
 * itself.
 */
export const MEMORY_ICON =
  "M10.8 2.6C11.1 2.6 11.5 3.3 11.8 3.3C12.1 3.3 11.9 2.8 12.5 2.8C13.1 2.8 14.4 2.9 15.5 3.2C16.6 3.5 17.9 3.8 18.9 4.6C19.9 5.4 20.8 6.9 21.4 8.2C22 9.5 22.6 10.9 22.7 12.2C22.8 13.5 22.6 14.7 22 15.8C21.4 16.9 20.2 18.3 19.1 18.9C18 19.5 16.3 19.1 15.6 19.5C14.9 19.9 15.1 20.8 14.7 21.1C14.3 21.4 13.6 21.9 13 21.4C12.4 20.8 11.9 18.6 11.4 17.8C10.9 17 11 16.7 10.1 16.3C9.2 16 7.1 16.1 6.2 15.7C5.3 15.2 5.3 14.1 4.6 13.6C3.9 13.1 2.8 13.1 2.2 12.6C1.7 12.1 1.4 11.3 1.3 10.4C1.2 9.5 1.2 8.2 1.6 7.3C2 6.4 2.3 5.7 3.6 4.9C4.9 4.2 8.1 3 9.2 2.8C10.3 2.5 9.7 3.4 10 3.4C10.3 3.4 10.5 2.6 10.8 2.6ZM7.7 10.8C7.6 11 7.2 12.1 6.8 12.3C6.4 12.5 5.6 12.1 5.3 12.1M11.5 8.5C11.6 8.8 12 9.9 12.4 10.2C12.8 10.5 13.6 10.4 13.8 10.5M20.6 13C20.4 13.1 19.5 13.1 19.3 13.4C19.1 13.7 19.1 14.4 19.2 14.8C19.3 15.2 19.6 15.4 19.7 15.5M4.5 7.3C4.5 7.6 4.3 8.6 4.6 8.8C4.9 9 6.2 8.7 6.5 8.7M9.1 3.4C9 3.5 8.4 3.6 8.3 3.9C8.2 4.2 8.3 4.7 8.6 4.9C8.9 5.1 9.8 4.8 10.2 4.9C10.6 5 10.7 5.4 10.8 5.5M15.2 8.7C15.4 8.9 16.2 9.5 16.3 10.1C16.4 10.7 16 11.8 16 12.1M21.9 14.4C21.8 14.6 21.7 15.5 21.3 15.9C20.9 16.3 20 16.5 19.6 16.9C19.2 17.3 19.2 18 18.9 18.3C18.6 18.7 17.9 18.9 17.7 19M13.5 15.6C13.1 15.7 11.2 15.4 11 16.1C10.8 16.8 12.3 18.9 12.6 19.5M13 13C12.8 13.2 12.5 13.8 12.1 13.9C11.7 14 10.7 13.9 10.4 13.9M12.9 4.8C13.1 4.8 13.7 4.7 14 4.9C14.3 5.1 14.6 5.8 14.7 6M17.4 7.4C17.6 7.2 18.4 6.5 18.9 6.5C19.4 6.5 20.2 7.3 20.4 7.5M19.7 11.2C19.9 11 20.4 10.2 20.7 10C21 9.8 21.2 10 21.4 10.3C21.6 10.6 22 11.3 22.1 11.5";

/**
 * The eye's almond outline, shared by the two marks drawn from it — `NAV_ICONS.traces` (an open
 * eye: watching the run) and `HIDDEN_ICON` (the same eye struck through). Composed rather than
 * typed twice so the pair cannot drift into looking unrelated.
 */
const EYE_OUTLINE = "M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z";

/**
 * The struck-through eye: the launcher fan's last entry, which puts the ball away. The slash runs
 * corner to corner rather than across the eye alone, because the open eye a few entries above it
 * in the same fan is the same outline, and the slash is the only thing telling the two apart.
 */
export const HIDDEN_ICON = `${EYE_OUTLINE}M3 3l18 18`;

/**
 * File glyphs, shared by every place a file operation is marked — the file summary card, the
 * memory-changes card, the context panel's file ranking — so a read, an edit and a write look
 * the same everywhere: a page with a folded corner, the same page with a plus (a full write),
 * and a pencil (an in-place edit).
 */
export const FILE_ICON = "M6 3h8l4 4v14H6zM14 3v4h4";
export const FILE_WRITE_ICON = "M6 3h8l4 4v14H6zM12 11v6M9 14h6";
export const FILE_EDIT_ICON = "M12 20h9M16.5 3.5a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z";

/**
 * Activity trace (a flat line with one tall beat in it): work still going on behind the
 * conversation — the background-task mark on a session row, the matching count in the chat
 * header, and the marker on a tool row whose call was made with `run_in_background`.
 *
 * A trace rather than the layered stack it replaces, which read as "layers" (a thing) instead
 * of "still running" (an event), and whose two parallelograms sit ~2.5px apart at the row's
 * 12px and merge into a smudge. One continuous stroke with a single tall beat keeps its shape
 * at that size, and it is nobody else's shape in these rows: not the hourglass or the compress
 * chevrons (`attention`, session activity), not the spinner ring or the circled check / cross
 * (a tool row's own status), not the unread dot.
 */
export const BACKGROUND_TASKS_ICON = "M2 12h4l3 9 6-18 3 9h4";

/**
 * Paper plane: remote control — the session-row mark for a Session that is relaying through
 * a messaging channel, the row menu's action that sets one up, and the dock's remote-control
 * panel, so the feature wears one mark wherever it appears. One shape for every
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
/**
 * Hook package (a fishing hook: eye, shank, bend and a barbed tip). The mark of hook packages
 * as a kind, wherever skills are marked by the book: the agents page's hook count, the harness
 * banner, and what a settings Hooks tab row draws when its package carries no plugin icon.
 */
export const HOOK_ICON =
  "M16 4a2 2 0 1 0-4 0 2 2 0 0 0 4 0zM14 6v8a5 5 0 0 1-10 0v-2m0 0l-2 2m2-2l2 2";

/**
 * Plugin (a puzzle piece, lucide's outline): the mark of the plugin library in the nav, and
 * what a plugin tile draws when the plugin ships no icon.svg of its own.
 */
export const PLUGIN_ICON =
  "M19.439 7.85c-.049.322.059.648.289.878l1.568 1.568c.47.47.706 1.087.706 1.704s-.235 1.233-.706 1.704l-1.611 1.611a.98.98 0 0 1-.837.276c-.47-.07-.802-.48-.968-.925a2.501 2.501 0 1 0-3.214 3.214c.446.166.855.497.925.968a.979.979 0 0 1-.276.837l-1.61 1.61a2.404 2.404 0 0 1-1.705.707 2.402 2.402 0 0 1-1.704-.706l-1.568-1.568a1.026 1.026 0 0 0-.877-.29c-.493.074-.84.504-1.02.968a2.5 2.5 0 1 1-3.237-3.237c.464-.18.894-.527.967-1.02a1.026 1.026 0 0 0-.289-.877l-1.568-1.568A2.402 2.402 0 0 1 1.998 12c0-.617.236-1.234.706-1.704L4.23 8.77c.24-.24.581-.353.917-.303.515.077.877.528 1.073 1.01a2.5 2.5 0 1 0 3.259-3.259c-.482-.196-.933-.558-1.01-1.073-.05-.336.062-.676.303-.917l1.525-1.525A2.402 2.402 0 0 1 12 1.998c.617 0 1.234.236 1.704.706l1.568 1.568c.23.23.556.338.877.29.493-.074.84-.504 1.02-.968a2.5 2.5 0 1 1 3.237 3.237c-.464.18-.894.527-.967 1.02Z";

/**
 * Magic wand with sparkles (after lucide's wand-sparkles, reduced to two sparkles so it still
 * reads at 13px): the mark of "Create with AI" wherever an object can be described to the agent
 * instead of configured by hand — the AI half of the create pair and the dialog's exit.
 */
export const MAGIC_WAND_ICON =
  "M21.64 3.64l-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72zM14 7l3 3M5 6v4M3 8h4M19 14v4M17 16h4";

/** An open hand — the "do it by hand" mark beside the wand, on the 24×24 grid. */
export const HAND_ICON =
  "M18 11V6a2 2 0 0 0-4 0M14 10V4a2 2 0 0 0-4 0v2M10 10.5V6a2 2 0 0 0-4 0v8M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15";

/**
 * Alarm clock — domed bells on its shoulders, a dial with hands, and two splayed feet: the mark
 * of scheduled tasks wherever they are counted, listed or created — the agents page's schedule
 * count, the chat dock's scheduled-tasks panel and the mark a session row wears while an enabled
 * task is bound to it. Distinct from the plain clock face that means "most recent" in the list
 * options.
 *
 * The smallest place it draws is the session row's 12px trailing cluster, which is what the
 * detail is bounded by: bells, feet and the hands' right angle each hold a whole pixel there,
 * while a second dial ring or ticks around the face would not, and the notch between the bells
 * is what keeps them reading as two.
 */
export const SCHEDULE_ICON =
  "M12 19.5a6.7 6.7 0 1 0 0-13.4 6.7 6.7 0 0 0 0 13.4zM12 8.9v3.9l2.6 1.8M3.1 7.7A3.5 3.5 0 0 1 7.7 4.3M16.3 4.3a3.5 3.5 0 0 1 4.6 3.4M7.8 18.8 5.4 21.6M16.2 18.8l2.4 2.8";

export const NAV_ICONS = {
  agents: AGENT_GROUP_ICON,
  /** Plugin library (the puzzle piece). */
  plugins: PLUGIN_ICON,
  /**
   * Model library (a chip: body, die and three pins a side). Three pins rather than the six a
   * real package would show — at the 16px these rows draw, six pins a side fuse into a serrated
   * edge and stop being pins. The die is what keeps the mark clear of `machines`, the next nav
   * row down: a bare body with side ticks and a stack of server units both reduce to "a rectangle
   * with lines", while concentric squares ringed with pins reduce to nothing else in this table.
   */
  models:
    "M5 5h14v14H5zM9 9h6v6H9zM7.5 5V2.4M12 5V2.4M16.5 5V2.4M7.5 19v2.6M12 19v2.6M16.5 19v2.6M5 7.5H2.4M5 12H2.4M5 16.5H2.4M19 7.5h2.6M19 12h2.6M19 16.5h2.6",
  /** Machines (two stacked server units, each with its own status lamp). */
  machines: "M4 4h16v6H4zM4 14h16v6H4zM7 7h.01M7 17h.01",
  usage: "M4 20V10m6 10V4m6 16v-7m4 7H2",
  /** Trace observation (an open eye with its pupil): watching what a run actually did. */
  traces: `${EYE_OUTLINE}M14.7 12a2.7 2.7 0 1 1-5.4 0 2.7 2.7 0 0 1 5.4 0z`,
  /** Benchmark center (a trophy: cup + two handles + base). */
  benchmark:
    "M7 4h10v5a5 5 0 0 1-10 0V4zM7 5H4v1a3 3 0 0 0 3 3m10-4h3v1a3 3 0 0 1-3 3M12 14v4m-4 0h8",
  /** Terminal (a `>_` prompt in a window frame). */
  terminal: "M3 5h18v14H3zM7 9l3 3-3 3M13 15h4",
} as const;
