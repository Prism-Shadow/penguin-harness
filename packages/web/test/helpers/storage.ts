/**
 * Browser storage for the node suite.
 *
 * Every `*Storage` interface in src (`SessionOrderStorage`, `DraftStorage`, …) is a slice of the
 * DOM `Storage`, and the modules that read the global take `localStorage` from it. One in-memory
 * `Storage` serves both: pass {@link memoryStorage} where a function takes a storage, or install
 * it as the global with {@link stubLocalStorage}. The package config sets `unstubGlobals`, so
 * the global goes away before the next test.
 */
import { vi } from "vitest";

/** A DOM `Storage` held in memory, with the map behind it for reading back what was written. */
export interface MemoryStorage extends Storage {
  readonly map: Map<string, string>;
}

/** A `Storage` holding `entries`, nothing else. */
export function memoryStorage(entries: Record<string, string> = {}): MemoryStorage {
  const map = new Map(Object.entries(entries));
  const storage = {
    map,
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => {
      map.delete(key);
    },
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
  };
  return storage as MemoryStorage;
}

/**
 * A `Storage` whose every call throws, the way a browser with site data blocked (or a
 * partitioned iframe) answers.
 */
export function blockedStorage(): Storage {
  const deny = (): never => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  return {
    get length(): number {
      return deny();
    },
    clear: deny,
    getItem: deny,
    key: deny,
    removeItem: deny,
    setItem: deny,
  } as Storage;
}

/** Installs `storage` as the global `localStorage` for the current test, and returns it. */
export function stubLocalStorage<T extends Storage = MemoryStorage>(
  storage: T = memoryStorage() as unknown as T,
): T {
  vi.stubGlobal("localStorage", storage);
  return storage;
}
