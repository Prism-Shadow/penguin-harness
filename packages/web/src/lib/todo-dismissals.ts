/**
 * "I have dealt with this" markers for the three dismissible badge trails, per Project.
 *
 * What is stored is not a hidden flag but the SIGNATURE the trail carried when it was
 * dismissed (`todo-badges.ts` explains why): the badge stays down only while what is waiting
 * is still exactly what the user waved away, and anything new raises it again.
 *
 * The server has no notion of a read receipt — there is no notifications table, and nothing in
 * `AgentSummary`, the models response or the errors page models "the user has seen this" — so
 * a server-side marker would need schema and API changes. This follows the precedent
 * `session-seen.ts` and `pinned-sessions.ts` already set for a per-user flag the API does not
 * model: persist it per Project in `localStorage` under the `penguin.…` key naming, with
 * injectable storage (vitest runs in Node, no localStorage), behind the same module store so
 * one write on a page re-renders the sidebar and the collapsed rail with it. The consequences
 * are the ones those files already accept and state — per BROWSER rather than per account, and
 * no cross-tab sync — and they are mild here: the cost of a lost marker is one red dot to clear
 * again, never lost work. The key is install-scoped in `install-scope.ts`: every signature
 * names Skills, models or errors belonging to one data root.
 */
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand/react";
import type { TodoKey } from "./todo-badges";

/** Storage key of one Project's markers (sidebar key-naming convention, `penguin.sessionSeen.<projectId>` &c.). */
export const todoDismissKey = (projectId: string): string => `penguin.todoDismissed.${projectId}`;

/** Minimal storage interface (the subset of localStorage used here); tests inject an in-memory implementation. */
export interface TodoDismissStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** One Project's markers: the dismissed signature per trail, absent where nothing was dismissed. */
export type TodoDismissals = Partial<Record<TodoKey, string>>;

/** The three keys, listed once so parsing cannot drift from the union. */
const TODO_KEYS: readonly TodoKey[] = ["skills", "models", "errors"];

const EMPTY: TodoDismissals = {};

function storageOf(injected?: TodoDismissStorage): TodoDismissStorage | null {
  if (injected) return injected;
  try {
    // localStorage is resolved INSIDE the try, never as a default parameter: merely touching it
    // throws a SecurityError when site data is blocked (or in a partitioned iframe).
    return localStorage;
  } catch {
    return null; // No storage at all (privacy mode edge): a dismissal simply does not persist.
  }
}

/**
 * Parses one Project's stored blob. Anything malformed degrades to "nothing dismissed", which
 * shows a dot the user can clear again — the failure direction that loses no information.
 * Non-string values are dropped per key rather than failing the whole record: a signature is
 * always a string, and one bad key must not resurrect the other two trails' dots.
 */
export function parseTodoDismissals(raw: string | null): TodoDismissals {
  if (raw === null) return EMPTY;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return EMPTY;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return EMPTY;
  const out: TodoDismissals = {};
  for (const key of TODO_KEYS) {
    const value = (parsed as Record<string, unknown>)[key];
    if (typeof value === "string") out[key] = value;
  }
  return out;
}

/** The markers after dismissing one trail at `signature` (pure; the caller persists the result). */
export function withDismissal(
  current: TodoDismissals,
  key: TodoKey,
  signature: string,
): TodoDismissals {
  return { ...current, [key]: signature };
}

// —— Module-level store: storage key → markers, every subscriber re-renders on change ——

// The Map doubles as the lazy parse cache: read() seeds a missing key IN PLACE (no new
// reference, no notification — it runs inside a render via useTodoDismissals's selector),
// while write() swaps in a new Map so subscribers are notified. Same shape as session-seen.ts.
const dismissStore = createStore<{ cache: Map<string, TodoDismissals> }>(() => ({
  cache: new Map(),
}));

function read(key: string, storage?: TodoDismissStorage): TodoDismissals {
  const { cache } = dismissStore.getState();
  const hit = cache.get(key);
  if (hit) return hit;
  const s = storageOf(storage);
  let state = EMPTY;
  if (s) {
    try {
      state = parseTodoDismissals(s.getItem(key));
    } catch {
      state = EMPTY;
    }
  }
  cache.set(key, state);
  return state;
}

function write(key: string, state: TodoDismissals, storage?: TodoDismissStorage): void {
  const s = storageOf(storage);
  if (s) {
    try {
      s.setItem(key, JSON.stringify(state));
    } catch {
      // Quota / private mode: the in-memory copy still serves this tab.
    }
  }
  dismissStore.setState((prev) => ({ cache: new Map(prev.cache).set(key, state) }));
}

/** Reactive read of one Project's markers (the EMPTY constant when no Project is selected). */
export function useTodoDismissals(projectId: string | null): TodoDismissals {
  return useStore(dismissStore, () => (projectId ? read(todoDismissKey(projectId)) : EMPTY));
}

/** Dismisses one trail at the signature it is showing right now, and persists it (best-effort). */
export function dismissTodo(
  projectId: string | null,
  key: TodoKey,
  signature: string,
  storage?: TodoDismissStorage,
): void {
  if (projectId === null) return;
  const storeKey = todoDismissKey(projectId);
  const current = read(storeKey, storage);
  if (current[key] === signature) return; // No-op: skip the write and the re-render.
  write(storeKey, withDismissal(current, key, signature), storage);
}
