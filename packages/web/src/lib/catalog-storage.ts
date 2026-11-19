/**
 * What each machine last answered a page that lists every machine's entries (the App Center's
 * apps), kept for the tab.
 *
 * A machine answers through this server's proxy, slowly, and drops out of reach while it is
 * being brought back. A page that showed only what answered right now would lose a machine's
 * tiles on every reload and every reconnect. So each answer is kept in `sessionStorage` — the
 * tab's, never the browser's — and shown, marked as not live, until the machine answers again.
 *
 * A snapshot is display data only: the caller's `snapshot` strips what a page never needs from a
 * cached copy (paths, file locations, setup references) before it is written. The key is the
 * caller's read key, which names the Project, the signed-in account and the machine
 * (lib/machine-catalogs.ts), so another account in the same tab reads nothing of it.
 *
 * Losing access revokes the copy: a read the machine refuses (401, 403) or answers as gone (404)
 * drops it (`discardOnError`), and {@link forgetCatalogs} drops the copies of keys that no longer
 * hold — a machine that left the Project, a sign-out, another data root — including copies a page
 * that has not mounted in this tab yet saved earlier.
 */
import { ApiError } from "../api/client";
import { createReadStore, readKey, type ReadStorage, type ReadStore } from "./read-store";

const CATALOG_PREFIX = "penguin.catalog.";
/** Between the kind and the read key in a storage key; no id the app mints contains it. */
const SEP = "\u0000";
/** Each store's way to drop the keys a test names from memory. */
const forgetters = new Set<(test: (key: string) => boolean) => void>();

/** The part every kept answer of one account in one Project starts with. */
export const catalogScope = (projectId: string, userId: string): string =>
  readKey(projectId, userId);

/** The read key of one machine's answer within a {@link catalogScope}. */
export const catalogKey = (scope: string, machineId: string): string => readKey(scope, machineId);

/** Whether a read key is one machine's within `scope`. */
export const inCatalogScope = (key: string, scope: string): boolean => key.startsWith(scope + SEP);

/** A refusal or a gone resource: what the machine answered no longer holds for this account. */
export const catalogAccessDenied = (err: unknown): boolean =>
  err instanceof ApiError && [401, 403, 404].includes(err.status);

/** Forgets every kept answer whose read key passes `test`, in memory and in the tab's storage. */
export function forgetCatalogs(test: (key: string) => boolean): void {
  for (const forget of forgetters) forget(test);
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(CATALOG_PREFIX) && test(key.slice(key.indexOf(SEP) + 1)))
        sessionStorage.removeItem(key);
    }
  } catch {
    // Storage refused: there is nothing kept to forget.
  }
}

/**
 * A read store (lib/read-store.ts) whose answers are kept in the tab under `kind`. `valid` rejects
 * a kept copy that no longer has the shape this build reads, so a stale one reads as nothing.
 */
export function createCatalogStore<T>(
  kind: string,
  snapshot: (value: T) => T,
  valid: (value: T) => boolean,
): ReadStore<T> {
  const prefix = CATALOG_PREFIX + kind + SEP;
  const seen = new Set<string>();
  const storage: ReadStorage<T> = {
    load(key) {
      seen.add(key);
      const raw = sessionStorage.getItem(prefix + key);
      if (!raw) return null;
      const value = JSON.parse(raw) as T;
      return valid(value) ? value : null;
    },
    save(key, value) {
      sessionStorage.setItem(prefix + key, JSON.stringify(snapshot(value)));
    },
    clear(key) {
      sessionStorage.removeItem(prefix + key);
    },
  };
  const store = createReadStore<T>({ storage, discardOnError: catalogAccessDenied });
  forgetters.add((test) => {
    for (const key of seen)
      if (test(key)) {
        store.forget(key);
        seen.delete(key);
      }
  });
  return store;
}
