/**
 * Pinned Sessions of the sidebar's conversation list (pure decisions, unit tested):
 * pinning a conversation bubbles its row to the top of its group's active list — the
 * row-level counterpart of the existing group pin, applied with the same `pinnedFirst`
 * ordering inside every grouping mode.
 *
 * Persistence is frontend-side: `SessionInfo` carries no pinned field and
 * `SessionPatchRequest` accepts none, so a server route would need schema + API
 * changes — deliberately out of scope here. Instead the ids persist per Project in
 * localStorage (`penguin.…` key naming, matching the sidebar's collapsed/pinned group
 * sets), with injectable storage (model-group-expansion.ts convention: vitest runs in
 * Node, no localStorage). Deleting a Session prunes its id via removePinnedSession;
 * ids orphaned by deletions elsewhere (another browser/device) stay inert — a pin is
 * a pure membership test and a row that never renders is never asked about.
 */

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface PinnedSessionsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Storage key of one Project's pinned-session id set (sidebar key-naming convention, `penguin.sidebarPinnedGroups.<projectId>` &c.). */
export const pinnedSessionsKey = (projectId: string): string =>
  `penguin.pinnedSessions.${projectId}`;

/**
 * Reads a Project's persisted pinned ids; no Project yet, nothing stored, or corrupted
 * storage degrade to the empty set (nothing pinned — the default). A stored array
 * survives element-level junk: non-strings are dropped, strings kept.
 */
export function loadPinnedSessions(
  projectId: string | null,
  storage?: PinnedSessionsStorage,
): Set<string> {
  if (projectId === null) return new Set();
  try {
    // localStorage is resolved INSIDE the try, never as a default parameter: merely
    // touching it throws a SecurityError when site data is blocked (or in a partitioned
    // iframe), and this runs from a useState initializer — an escaping throw would take
    // the whole sidebar's first render down.
    const store = storage ?? localStorage;
    const parsed: unknown = JSON.parse(store.getItem(pinnedSessionsKey(projectId)) ?? "[]");
    return new Set(
      Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [],
    );
  } catch {
    return new Set();
  }
}

/** Writes a Project's pinned ids on every change (best-effort: quota limits / private browsing fail silently). */
export function savePinnedSessions(
  projectId: string | null,
  pinned: ReadonlySet<string>,
  storage?: PinnedSessionsStorage,
): void {
  if (projectId === null) return;
  try {
    (storage ?? localStorage).setItem(pinnedSessionsKey(projectId), JSON.stringify([...pinned]));
  } catch {
    /* best-effort persistence (quota limits / private browsing) */
  }
}

/** Immutable pin/unpin of one Session id (state-updater shape; the input set is never mutated). */
export function togglePinnedSession(pinned: ReadonlySet<string>, sessionId: string): Set<string> {
  const next = new Set(pinned);
  if (next.has(sessionId)) next.delete(sessionId);
  else next.add(sessionId);
  return next;
}

/**
 * Prune on Session delete: drops the id, returning the INPUT set unchanged (same
 * reference) when it wasn't pinned — callers skip the state update and storage write
 * on the common unpinned path.
 */
export function removePinnedSession(
  pinned: ReadonlySet<string>,
  sessionId: string,
): ReadonlySet<string> {
  if (!pinned.has(sessionId)) return pinned;
  const next = new Set(pinned);
  next.delete(sessionId);
  return next;
}
