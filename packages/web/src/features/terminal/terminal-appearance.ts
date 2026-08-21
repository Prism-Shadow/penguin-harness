/**
 * The terminal's chrome palette, resolved in JS rather than through Tailwind's `dark:`.
 *
 * That variant is anchored on the root class (`&:where(.dark, .dark *)` in styles.css), so
 * a subtree can opt IN to dark but never out of it — and the terminal's appearance is its
 * own setting (see TerminalThemeMode), which means a light terminal inside a dark app has
 * to be expressible. Hence whole class strings picked by a resolved boolean.
 *
 * The values are the same gray pairs the rest of the app uses; only the way they are
 * selected differs. What the terminal SCREEN uses is a separate concern — the sixteen ANSI
 * colours live in terminal-view.tsx.
 */
import { useTheme } from "../../state/theme";

export interface TerminalChrome {
  /** True when the terminal is painting dark, whatever the app is doing. */
  dark: boolean;
  /** Pane/page background and default text. */
  surface: string;
  /** Border colour for the pane edge and the header rule (pair with border-b/border-t/…). */
  border: string;
  /** Header icon buttons (detach, new shell, close). */
  iconButton: string;
  /** The header's drag grip. */
  grip: string;
  tabActive: string;
  tabIdle: string;
  /** The tab's hover-revealed kill button: an opaque backdrop matching the tab under it. */
  tabKill: string;
  /** Secondary text (a path, an error detail). */
  muted: string;
  /** A live/healthy status mark (the header's connection dot). */
  success: string;
  /** An in-progress status mark waiting on something. */
  attention: string;
  /** Failure headline, and a failed status mark. */
  danger: string;
  /** Bordered text button (retry, detach on the standalone page). */
  outlineButton: string;
}

const DARK: TerminalChrome = {
  dark: true,
  surface: "bg-gray-950 text-gray-100",
  border: "border-gray-800",
  iconButton: "text-gray-400 hover:bg-gray-800 hover:text-gray-200",
  grip: "text-gray-600",
  tabActive: "bg-gray-800 text-gray-100",
  tabIdle: "text-gray-400 hover:bg-gray-800 hover:text-gray-200",
  tabKill: "bg-gray-800 hover:bg-gray-700",
  muted: "text-gray-400",
  // The dark halves of the shared status tones (lib/tone.ts); they cannot be written as
  // `dark:` pairs here for the reason in the file header.
  success: "text-emerald-400",
  attention: "text-amber-400",
  danger: "text-red-400",
  outlineButton: "border-gray-700 text-gray-300 hover:bg-gray-800",
};

const LIGHT: TerminalChrome = {
  dark: false,
  surface: "bg-white text-gray-900",
  border: "border-gray-200",
  iconButton: "text-gray-500 hover:bg-gray-100 hover:text-gray-800",
  grip: "text-gray-400",
  tabActive: "bg-gray-100 text-gray-900",
  tabIdle: "text-gray-500 hover:bg-gray-100 hover:text-gray-800",
  tabKill: "bg-gray-100 hover:bg-gray-200",
  muted: "text-gray-500",
  /** The light halves of the shared status tones (lib/tone.ts). */
  success: "text-emerald-600",
  attention: "text-amber-600",
  danger: "text-red-600",
  outlineButton: "border-gray-300 text-gray-600 hover:bg-gray-100",
};

export function useTerminalChrome(): TerminalChrome {
  return useTheme().terminalDark ? DARK : LIGHT;
}
