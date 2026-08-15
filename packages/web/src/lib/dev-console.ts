/**
 * Dev console (Ctrl+P / Cmd+P) pure logic: the shortcut matcher and the cross-reload
 * event feed. Split out from the component (dev-console.tsx) so it is testable under
 * vitest's node environment (no DOM/webStorage there — see vitest.config.ts).
 *
 * Cross-reload visibility: `web_updated` triggers an immediate `location.reload()`
 * (state/sessions.tsx) — there is no window where the console could catch the event
 * live. Instead, the SSE handler records it here (sessionStorage, survives the reload
 * but not a tab close) before reloading; the console reads the feed back on open, so
 * "just updated to rev X" is visible after the page comes back.
 */

/** One entry in the update feed. Only `web_updated` is tracked today (see the module doc). */
export interface DevConsoleEvent {
  type: "web_updated";
  rev: string;
  /** ISO 8601, client clock (the event has no server timestamp of its own). */
  at: string;
}

/** The subset of the Web Storage API the feed needs — lets tests pass an in-memory fake. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const STORAGE_KEY = "penguin.devConsole.events";
/** Feed cap: a dev console is for "what just happened", not a full history. */
const MAX_EVENTS = 20;

function isDevConsoleEvent(v: unknown): v is DevConsoleEvent {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r.type === "web_updated" && typeof r.rev === "string" && typeof r.at === "string";
}

/** Reads the persisted feed, oldest first; tolerates missing/corrupt storage (never throws). */
export function readDevConsoleEvents(storage: StorageLike): DevConsoleEvent[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isDevConsoleEvent) : [];
  } catch {
    return [];
  }
}

/**
 * Appends one event and persists the capped feed (oldest dropped first beyond
 * MAX_EVENTS). Returns the new feed so the caller (the SSE handler, which runs outside
 * any mounted console) doesn't need a second read.
 */
export function recordDevConsoleEvent(
  storage: StorageLike,
  event: DevConsoleEvent,
): DevConsoleEvent[] {
  const next = [...readDevConsoleEvents(storage), event].slice(-MAX_EVENTS);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full/unavailable (private-browsing quota, etc.): the caller still gets
    // `next` back for this render; only cross-reload persistence is lost.
  }
  return next;
}

/** Keyboard-event shape the matcher needs (a subset of KeyboardEvent, for easy testing). */
export type ShortcutKeyEvent = Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">;

/**
 * Ctrl+P (Cmd+P on mac) toggles the command palette. `isMac` is injected (from navigator
 * at the call site) rather than read here, so the matcher stays a pure function to
 * unit-test. Browsers report the letter itself regardless of modifiers, so `key` alone
 * (case-folded) identifies the physical P key without depending on layout/shift state.
 */
export function isCommandPaletteShortcut(e: ShortcutKeyEvent, isMac: boolean): boolean {
  if (e.key.toLowerCase() !== "p") return false;
  return isMac ? e.metaKey : e.ctrlKey;
}

/**
 * Palette filtering, VSCode-style-lite: every whitespace-separated query token must
 * appear as a case-insensitive substring of the action label (in any order); an empty
 * query keeps everything, in registration order. Deliberately not fuzzy-per-character —
 * with a handful of actions, substring tokens are predictable and never surprising.
 */
export function filterPaletteActions<A extends { label: string }>(
  actions: readonly A[],
  query: string,
): A[] {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [...actions];
  return actions.filter((a) => {
    const label = a.label.toLowerCase();
    return tokens.every((t) => label.includes(t));
  });
}
