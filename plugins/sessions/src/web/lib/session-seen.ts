import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";

/**
 * Per-Session "the user has seen the latest reply" markers — the read/unread half of the
 * sidebar's completion glyph.
 *
 * The server has no notion of a read receipt: there is no notifications table, no read/seen
 * column on `sessions`, and `SessionInfo` carries no such field, so a server-side marker would
 * need schema + API changes. This follows the precedent pinned-sessions.ts already set for a
 * per-Session flag the API does not model: persist it per Project in localStorage under the
 * `penguin.…` key naming, with injectable storage (vitest runs in Node, no localStorage).
 *
 * Consequences, deliberately accepted:
 * - per BROWSER, not per user — the same account on another device starts with its own markers;
 * - no cross-tab sync — the repo has no `storage` listener anywhere and says so on purpose
 *   (chat-defaults-event.ts: "Same-tab only by design"), so a second tab keeps its own view
 *   until it reloads.
 *
 * "Read" is a timestamp comparison rather than a flag, because the question is not "was this
 * Session ever opened" but "was it opened SINCE its last reply": the marker holds when the user
 * last looked, and `SessionInfo.lastActiveAt` (stamped by the server at run start and again at
 * run end) holds when the Session last did anything. Later activity than the marker = unread.
 */

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface SessionSeenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage key of one Project's seen markers (sidebar key-naming convention, `penguin.pinnedSessions.<projectId>` &c.). */
export const sessionSeenKey = (projectId: string): string => `penguin.sessionSeen.${projectId}`;

/**
 * Cap on remembered markers per Project. Only Sessions the user actually opened get one, so
 * this is generous; past it the least recently seen are dropped, and a dropped Session falls
 * back to `seededAt` — i.e. reads as read, not as a surprise unread.
 */
const MAX_MARKERS = 500;

/** One Project's markers: when the user last looked at each Session, plus the baseline below. */
export interface SessionSeenState {
  /**
   * Epoch ms first written for this Project. Everything that last ran at or before it counts as
   * read without its own marker — otherwise enabling the feature would light up every historical
   * conversation at once, which is noise, not information.
   */
  seededAt: number;
  /** sessionId → epoch ms the user last had it open. */
  seen: ReadonlyMap<string, number>;
}

const EMPTY: SessionSeenState = { seededAt: 0, seen: new Map() };

function storageOf(injected?: SessionSeenStorage): SessionSeenStorage | null {
  if (injected) return injected;
  try {
    // localStorage is resolved INSIDE the try, never as a default parameter: merely touching it
    // throws a SecurityError when site data is blocked (or in a partitioned iframe).
    return localStorage;
  } catch {
    return null; // No storage at all (privacy mode edge): every finished Session reads as read.
  }
}

/** Parses one Project's stored blob; anything malformed degrades to "nothing remembered". */
export function parseSessionSeen(raw: string | null): SessionSeenState {
  if (raw === null) return EMPTY;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return EMPTY;
    const o = parsed as { seededAt?: unknown; seen?: unknown };
    const seededAt = typeof o.seededAt === "number" && Number.isFinite(o.seededAt) ? o.seededAt : 0;
    const seen = new Map<string, number>();
    if (typeof o.seen === "object" && o.seen !== null) {
      for (const [id, at] of Object.entries(o.seen as Record<string, unknown>)) {
        if (typeof at === "number" && Number.isFinite(at)) seen.set(id, at);
      }
    }
    return { seededAt, seen };
  } catch {
    return EMPTY;
  }
}

/** Serializes one Project's markers, keeping only the `MAX_MARKERS` most recently seen. */
export function serializeSessionSeen(state: SessionSeenState): string {
  let entries = [...state.seen];
  if (entries.length > MAX_MARKERS) {
    entries.sort((a, b) => b[1] - a[1]);
    entries = entries.slice(0, MAX_MARKERS);
  }
  return JSON.stringify({ seededAt: state.seededAt, seen: Object.fromEntries(entries) });
}

/**
 * Records that the user is looking at a Session now.
 *
 * The marker is the LATER of the wall clock and the Session's own `lastActiveAt`, so opening a
 * Session always marks it read even when this browser's clock lags the server's — a stuck unread
 * badge is the failure users actually notice.
 */
export function markSessionSeen(
  state: SessionSeenState,
  sessionId: string,
  lastActiveAt: string,
  now: number = Date.now(),
): SessionSeenState {
  const activeAt = Date.parse(lastActiveAt);
  const at = Number.isNaN(activeAt) ? now : Math.max(now, activeAt);
  if (state.seen.get(sessionId) === at) return state; // No-op: skip the write and the re-render.
  return { seededAt: state.seededAt, seen: new Map(state.seen).set(sessionId, at) };
}

/** Prune on Session delete; returns the input state unchanged when nothing was remembered. */
export function forgetSessionSeen(state: SessionSeenState, sessionId: string): SessionSeenState {
  if (!state.seen.has(sessionId)) return state;
  const seen = new Map(state.seen);
  seen.delete(sessionId);
  return { seededAt: state.seededAt, seen };
}

/**
 * Whether a Session has run since the user last looked at it.
 *
 * Unknown Sessions fall back to `seededAt`, so only activity after this browser first saw the
 * Project counts as unread. An unparseable timestamp reads as read (never invent an alert).
 */
export function isSessionUnread(state: SessionSeenState, sessionId: string, lastActiveAt: string) {
  const activeAt = Date.parse(lastActiveAt);
  if (Number.isNaN(activeAt)) return false;
  return activeAt > (state.seen.get(sessionId) ?? state.seededAt);
}

// —— Module-level store: storage key → markers, every subscriber re-renders on change ——

// The Map doubles as the lazy parse cache: read() seeds a missing key IN PLACE (no new
// reference, no notification — it runs inside a render via useSessionSeen's selector), while
// write() swaps in a new Map so subscribers are notified. Same shape as draft-sessions.ts.
const seenStore = createStore<{ cache: Map<string, SessionSeenState> }>(() => ({
  cache: new Map(),
}));

function read(key: string, storage?: SessionSeenStorage): SessionSeenState {
  const { cache } = seenStore.getState();
  const hit = cache.get(key);
  if (hit) return hit;
  const s = storageOf(storage);
  let state = EMPTY;
  if (s) {
    try {
      state = parseSessionSeen(s.getItem(key));
    } catch {
      state = EMPTY;
    }
  }
  cache.set(key, state);
  return state;
}

function write(key: string, state: SessionSeenState, storage?: SessionSeenStorage): void {
  const s = storageOf(storage);
  if (s) {
    try {
      s.setItem(key, serializeSessionSeen(state));
    } catch {
      // Quota / private mode: the in-memory copy still serves this tab.
    }
  }
  seenStore.setState((prev) => ({ cache: new Map(prev.cache).set(key, state) }));
}

/** Reactive read of one Project's markers (the EMPTY constant when no Project is selected). */
export function useSessionSeen(projectId: string | null): SessionSeenState {
  return useStore(seenStore, () => (projectId ? read(sessionSeenKey(projectId)) : EMPTY));
}

/**
 * Marks a Session read. Also stamps `seededAt` on a Project's first ever write, which is what
 * makes pre-existing conversations start out read rather than all-unread.
 */
export function noteSessionSeen(
  projectId: string | null,
  sessionId: string,
  lastActiveAt: string,
  storage?: SessionSeenStorage,
): void {
  if (projectId === null) return;
  const key = sessionSeenKey(projectId);
  const current = read(key, storage);
  const seeded = current.seededAt === 0 ? { seededAt: Date.now(), seen: current.seen } : current;
  const next = markSessionSeen(seeded, sessionId, lastActiveAt);
  if (next === current) return;
  write(key, next, storage);
}

/** Drops a deleted Session's marker so the id cannot linger in storage forever. */
export function forgetSession(
  projectId: string | null,
  sessionId: string,
  storage?: SessionSeenStorage,
): void {
  if (projectId === null) return;
  const key = sessionSeenKey(projectId);
  const current = read(key, storage);
  const next = forgetSessionSeen(current, sessionId);
  if (next === current) return;
  write(key, next, storage);
}

/** Test seam: drops the in-memory parse cache so a fresh storage stub is re-read. */
export function resetSessionSeenCache(): void {
  seenStore.setState({ cache: new Map() });
}
