/**
 * Command palette (Ctrl+P / Cmd+P) pure logic: the shortcut matcher and the action
 * filter, kept apart from the component so they are testable without a DOM.
 */

/** Keyboard-event shape the matcher needs (a subset of KeyboardEvent, for easy testing). */
export type ShortcutKeyEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

/**
 * Ctrl+P on Windows/Linux, Cmd+P on macOS — the platform is a parameter (read once at
 * the call site) so the matcher stays a pure function. Shift and Alt must be up: Ctrl+Shift+P
 * belongs to the browser's own tooling, and a chord with Alt is never ours.
 */
export function isCommandPaletteShortcut(e: ShortcutKeyEvent, isMac: boolean): boolean {
  if (e.key !== "p" && e.key !== "P") return false;
  if (e.altKey || e.shiftKey) return false;
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
}

export interface PaletteAction {
  id: string;
  label: string;
  /** Searchable words beyond the label (an English alias under a Chinese label, say). */
  keywords?: readonly string[];
  run: () => void;
}

/**
 * Palette filtering, VSCode-style-lite: every whitespace-separated query token must appear
 * (case-insensitive substring) in the label or a keyword, in any order. Predictable over
 * fuzzy for a handful of actions; an empty query lists everything in registration order.
 */
export function filterPaletteActions<A extends { label: string; keywords?: readonly string[] }>(
  actions: readonly A[],
  query: string,
): A[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...actions];
  return actions.filter((a) => {
    const hay = [a.label, ...(a.keywords ?? [])].join(" ").toLowerCase();
    return tokens.every((t) => hay.includes(t));
  });
}
