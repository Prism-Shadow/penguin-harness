/**
 * This browser's cache of what the account keeps on the server — the Settings pages'
 * preferences and the unsent drafts — and the two signals that tie the cache to the account.
 *
 * The values live where they always did, under their `penguin.*` localStorage keys, because the
 * first frame needs them synchronously: the pre-paint script reads the theme from there, and a
 * composer mounts with its draft from there. What changed is who owns them. The account's copy
 * on the server is the truth; the cache is what this browser last knew of it (sync.ts).
 *
 * So there are two directions, and this module is the seam between them:
 *   - A user edit goes through {@link writeCached} (a preference) or {@link syncedStorage} (a
 *     draft), which write the cache and report the key, so sync.ts can carry it to the account.
 *   - The account's values are written into the cache by sync.ts directly, never through these
 *     two — a value that came from the account must not be reported back to it — and then
 *     {@link noteAccountApplied} tells every holder of an in-memory copy to read the cache again.
 *
 * A leaf: it imports nothing of the app, so the stores that report through it and the sync
 * module that listens can both import it without a cycle.
 */

type Listener<T> = (value: T) => void;

const writeListeners = new Set<Listener<string>>();
const appliedListeners = new Set<Listener<void>>();

/** Hears every cached key a user edit wrote or removed. Returns the unsubscribe. */
export function subscribeCachedWrites(listener: (key: string) => void): () => void {
  writeListeners.add(listener);
  return () => void writeListeners.delete(listener);
}

function noteWrite(key: string): void {
  for (const listener of [...writeListeners]) listener(key);
}

/**
 * Writes (or, with null, removes) a cached preference as a user edit. The storage call is made
 * as it is — a full quota or blocked site data throws to the caller, which already decides what
 * a failed write means for its control — and only a write that happened is reported.
 */
export function writeCached(key: string, value: string | null): void {
  if (value === null) localStorage.removeItem(key);
  else localStorage.setItem(key, value);
  noteWrite(key);
}

/**
 * The storage the draft modules read and write through: `localStorage`, with every write and
 * removal reported. Resolved on each call rather than captured, because merely touching
 * `localStorage` throws where site data is blocked — the callers already catch that.
 */
export const syncedStorage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem: (key) => localStorage.getItem(key),
  setItem: (key, value) => {
    localStorage.setItem(key, value);
    noteWrite(key);
  },
  removeItem: (key) => {
    localStorage.removeItem(key);
    noteWrite(key);
  },
};

/**
 * Hears that the account's values were just written into this browser's cache: anything holding
 * a copy of a cached value in memory reads it again. Returns the unsubscribe.
 */
export function subscribeAccountApplied(listener: () => void): () => void {
  appliedListeners.add(listener);
  return () => void appliedListeners.delete(listener);
}

/** Called by sync.ts after it wrote the account's values into the cache. */
export function noteAccountApplied(): void {
  for (const listener of [...appliedListeners]) listener();
}
