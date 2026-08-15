/**
 * The cross-reload HMR event feed: sessionStorage-backed, so it survives the reload
 * `web_updated` triggers but not a tab close. Split out from its one caller
 * (dev-tools.ts) so it is testable under vitest's node environment (no DOM/webStorage
 * there — see vitest.config.ts).
 *
 * Cross-reload visibility: `web_updated` triggers an immediate `location.reload()`
 * (state/sessions.tsx) — a fresh page means a fresh developer console. The SSE handler
 * records the event here before reloading, and dev-tools.ts replays the latest entry
 * as a console.info line on the next page load — so "just updated to rev X" is what
 * the developer console shows after the page comes back.
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
