/**
 * The command palette's shortcut (Ctrl+P / Cmd+P), kept apart from the component that binds it so
 * it is testable without a DOM. The palette itself, with its action filter, is the UI package's
 * CommandPalette.
 */

/** Keyboard-event shape the matcher needs (a subset of KeyboardEvent, for easy testing). */
export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

/**
 * Ctrl+P and Ctrl+Shift+P on Windows/Linux, Cmd+P and Cmd+Shift+P on macOS — the platform
 * is a parameter (read once at the call site) so the matcher stays a pure function. Shift is
 * accepted because a workflow page that fills the app may itself take Ctrl+P (print, its
 * own shortcut); the palette is that page's only way out, so it has to answer both chords.
 * A chord with Alt is never ours.
 */
export function isCommandPaletteShortcut(e: ShortcutKeyEvent, isMac: boolean): boolean {
  if (e.key !== "p" && e.key !== "P") return false;
  if (e.altKey) return false;
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}
