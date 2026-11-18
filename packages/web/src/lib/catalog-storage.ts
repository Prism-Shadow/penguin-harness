import { ApiError } from "../api/client";
import { createReadStore, type ReadStorage } from "./read-store";

const CATALOG_PREFIX = "penguin.catalog.";
const SEP = "\u0000";
const forgetters = new Set<(test: (key: string) => boolean) => void>();
export const catalogAccessDenied = (err: unknown) =>
  err instanceof ApiError && [401, 403, 404].includes(err.status);

/** Forget snapshots, including those saved by a page that hasn't mounted in this tab yet. */
export function forgetCatalogs(test: (key: string) => boolean) {
  for (const forget of forgetters) forget(test);
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(CATALOG_PREFIX) && test(key.slice(key.indexOf(SEP) + 1)))
        sessionStorage.removeItem(key);
    }
  } catch {
    /* Storage may be unavailable. */
  }
}

export function createCatalogStore<T>(
  kind: string,
  snapshot: (value: T) => T,
  valid: (value: T) => boolean,
) {
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
