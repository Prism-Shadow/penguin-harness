/**
 * The company sidebar's Temporary group: the ticket sessions the reader opened from a ticket.
 *
 * Ticket sessions are never listed wholesale. There are many of them, and each belongs to the
 * ticket that started it. But a conversation opened from a ticket needs a place in the sidebar
 * that names it and leads back to it later. So opening one from a ticket's dialog adds it to
 * this list, and the sidebar draws the list as a collapsible group below the Desks group:
 *
 * - Opening a session puts it at the top, or moves it there if it is already listed.
 * - An entry stays until the reader removes it: its own ✕, or the group's "Close all". Nothing
 *   else does — going elsewhere keeps it, a reload keeps it, and the list has no cap.
 * - A desk session is never listed: its desk row already names it.
 *
 * The list is kept in localStorage, one key per user, Project and organization: two people on
 * one browser keep separate lists, and one organization's sessions never show in another's
 * sidebar. Nothing here follows the location; where the reader is only decides which row is
 * marked as the one on screen.
 *
 * The list logic is pure, and the store takes its storage as an argument (vitest runs in Node,
 * with no localStorage). A read that fails lists nothing, and a write that fails keeps the list
 * in memory for this tab.
 */
import { useSyncExternalStore } from "react";

/** One ticket session in the Temporary group. */
export interface TempSessionEntry {
  sessionId: string;
  /** The employee the session runs as: the row's avatar. */
  agentId: string;
  /** The title the ticket listed it under, until the session list has its own. */
  title: string;
}

/** A row the group draws: an entry, marked when it is the session on screen. */
export interface TempSessionRow extends TempSessionEntry {
  active: boolean;
}

/** The route a Session opens at. */
export function chatPath(sessionId: string): string {
  return `/chat/${sessionId}`;
}

const KEY_PREFIX = "penguin.orgTempSessions.";

/** The list's storage key: one per user, Project and organization. A signed-out browser gets its own bucket. */
export function tempSessionsKey(userId: string | null, projectId: string, orgId: string): string {
  return `${KEY_PREFIX}${userId ?? ""}.${projectId}.${orgId}`;
}

function isDesk(sessionId: string, deskSessionIds: Iterable<string | null>): boolean {
  for (const id of deskSessionIds) if (id === sessionId) return true;
  return false;
}

const EMPTY: readonly TempSessionEntry[] = [];

/**
 * The list after opening `entry`: at the top and listed once. A desk session leaves the list as
 * it was, the same array.
 */
export function withOpened(
  list: readonly TempSessionEntry[],
  entry: TempSessionEntry,
  deskSessionIds: Iterable<string | null> = [],
): readonly TempSessionEntry[] {
  if (isDesk(entry.sessionId, deskSessionIds)) return list;
  return [entry, ...list.filter((e) => e.sessionId !== entry.sessionId)];
}

/** The list after removing one session. A session it does not hold leaves it as it was, the same array. */
export function withDismissed(
  list: readonly TempSessionEntry[],
  sessionId: string,
): readonly TempSessionEntry[] {
  if (!list.some((e) => e.sessionId === sessionId)) return list;
  return list.filter((e) => e.sessionId !== sessionId);
}

/**
 * The rows the group draws, wherever the reader is: every entry except a desk session, which
 * has its desk row. The session on screen is marked; being somewhere else only moves the mark.
 */
export function tempSessionRows(
  list: readonly TempSessionEntry[],
  deskSessionIds: Iterable<string | null>,
  activeSessionId: string | null,
): TempSessionRow[] {
  const desks = new Set(deskSessionIds);
  return list
    .filter((e) => !desks.has(e.sessionId))
    .map((e) => ({ ...e, active: e.sessionId === activeSessionId }));
}

/**
 * A stored list. Only this module's store writes the key, always a whole list, so what is there
 * is read as written; a value that is not JSON lists nothing (the localStorage convention of
 * page-hints.ts).
 */
export function parseTempSessions(raw: string | null): TempSessionEntry[] {
  if (raw === null || raw === "") return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  return Array.isArray(parsed) ? (parsed as TempSessionEntry[]) : [];
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

/** The subset of localStorage the store uses; tests pass an in-memory one. */
export interface TempSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TempSessionStore {
  /** One list, newest first. The same array until it changes, as useSyncExternalStore needs. */
  list(key: string): readonly TempSessionEntry[];
  open(key: string, entry: TempSessionEntry, deskSessionIds?: Iterable<string | null>): void;
  dismiss(key: string, sessionId: string): void;
  /** Removes every entry of one list at once. */
  dismissAll(key: string): void;
  /** Drops the copy held for `key` (for every key when null), so the next read goes back to storage. */
  reread(key: string | null): void;
  subscribe(listener: () => void): () => void;
}

/**
 * A store over `storage`, resolved on each access so a storage that throws (blocked site data)
 * is caught where it is used. Each list is read from storage once and then held in memory.
 */
export function createTempSessionStore(
  storage: () => TempSessionStorage | null | undefined,
): TempSessionStore {
  const lists = new Map<string, readonly TempSessionEntry[]>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of listeners) listener();
  };

  const list = (key: string): readonly TempSessionEntry[] => {
    const held = lists.get(key);
    if (held !== undefined) return held;
    let read: readonly TempSessionEntry[] = EMPTY;
    try {
      const parsed = parseTempSessions(storage()?.getItem(key) ?? null);
      if (parsed.length > 0) read = parsed;
    } catch {
      // Unreadable storage: nothing is listed.
    }
    lists.set(key, read);
    return read;
  };

  const write = (key: string, next: readonly TempSessionEntry[]): void => {
    lists.set(key, next);
    try {
      const target = storage();
      if (next.length === 0) target?.removeItem(key);
      else target?.setItem(key, JSON.stringify(next));
    } catch {
      // Quota or blocked storage: the list lasts as long as this tab.
    }
    notify();
  };

  return {
    list,
    open(key, entry, deskSessionIds = []) {
      const current = list(key);
      const next = withOpened(current, entry, deskSessionIds);
      if (next !== current) write(key, next);
    },
    dismiss(key, sessionId) {
      const current = list(key);
      const next = withDismissed(current, sessionId);
      if (next !== current) write(key, next);
    },
    dismissAll(key) {
      if (list(key).length > 0) write(key, EMPTY);
    },
    reread(key) {
      if (key === null) lists.clear();
      else if (!lists.delete(key)) return;
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** The app's store, over this browser's localStorage. */
const store = createTempSessionStore(() => globalThis.localStorage);

let watchingOtherTabs = false;

/**
 * Another tab's write replaces the copy held here. Without this, a tab still holding an entry
 * that another tab removed would write it back the next time it opened or removed one.
 */
function watchOtherTabs(): void {
  if (watchingOtherTabs || typeof window === "undefined") return;
  watchingOtherTabs = true;
  window.addEventListener("storage", (event) => {
    if (event.key === null) store.reread(null);
    else if (event.key.startsWith(KEY_PREFIX)) store.reread(event.key);
  });
}

function subscribe(listener: () => void): () => void {
  watchOtherTabs();
  return store.subscribe(listener);
}

/** One organization's Temporary list for this user, newest first. */
export function useTempSessions(
  userId: string | null,
  projectId: string,
  orgId: string,
): readonly TempSessionEntry[] {
  const key = tempSessionsKey(userId, projectId, orgId);
  const read = (): readonly TempSessionEntry[] => store.list(key);
  return useSyncExternalStore(subscribe, read, read);
}

/** Adds a ticket session to the list, or moves it to the top; a desk session is left out. The caller navigates to it. */
export function openTempSession(
  userId: string | null,
  projectId: string,
  orgId: string,
  entry: TempSessionEntry,
  deskSessionIds: Iterable<string | null>,
): void {
  store.open(tempSessionsKey(userId, projectId, orgId), entry, deskSessionIds);
}

/** Removes one entry. Nothing navigates: the page stays where it is, even on that session. */
export function dismissTempSession(
  userId: string | null,
  projectId: string,
  orgId: string,
  sessionId: string,
): void {
  store.dismiss(tempSessionsKey(userId, projectId, orgId), sessionId);
}

/**
 * The group's "Close all": every entry of this organization's list at once, with no
 * confirmation — the sessions themselves are untouched, and each is still one click away in
 * its ticket. Nothing navigates.
 */
export function dismissAllTempSessions(
  userId: string | null,
  projectId: string,
  orgId: string,
): void {
  store.dismissAll(tempSessionsKey(userId, projectId, orgId));
}
