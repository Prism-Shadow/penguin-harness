/**
 * The Plugins page's "incompatible plugins only" filter: a display preference of this browser
 * (`penguin.pluginsIncompatibleOnly`), switched in Settings › Plugins and by the page's own
 * notices, and read by the page to narrow its list to the plugins this build cannot fully run.
 *
 * A tiny store rather than a plain read, because the switch and the list it filters are on screen
 * together: the Settings dialog opens over the page, and the list has to follow the switch the
 * moment it flips. The value is read from storage once and kept in memory afterwards; as with the
 * dock launcher's preference, a change made in another tab shows after a reload.
 */
import { useSyncExternalStore } from "react";

export const PLUGINS_INCOMPATIBLE_ONLY_KEY = "penguin.pluginsIncompatibleOnly";
const ON = "1";
const OFF = "0";

/** The storage this preference reads and writes: localStorage, or a stand-in in tests. */
export type IncompatibleOnlyStorage = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): IncompatibleOnlyStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null; // the accessor itself throws where site data is blocked
  }
}

const listeners = new Set<() => void>();
let cache: boolean | null = null;

function storedIn(storage: IncompatibleOnlyStorage | null): boolean {
  try {
    return storage?.getItem(PLUGINS_INCOMPATIBLE_ONLY_KEY) === ON;
  } catch {
    return false;
  }
}

/**
 * Whether the page lists only the incompatible plugins. Off unless the stored value is exactly
 * "1": a list that hides plugins must never be the result of a missing or garbled value. An
 * explicit storage bypasses the cache.
 */
export function readPluginsIncompatibleOnly(storage?: IncompatibleOnlyStorage | null): boolean {
  if (storage !== undefined) return storedIn(storage);
  if (cache === null) cache = storedIn(defaultStorage());
  return cache;
}

/** Turns the filter on or off and tells everything rendering from it. */
export function writePluginsIncompatibleOnly(
  on: boolean,
  storage?: IncompatibleOnlyStorage | null,
): void {
  const target = storage === undefined ? defaultStorage() : storage;
  try {
    target?.setItem(PLUGINS_INCOMPATIBLE_ONLY_KEY, on ? ON : OFF);
  } catch {
    // Private-mode storage failures only cost persistence; this session still updates.
  }
  if (storage === undefined) cache = on;
  for (const listener of listeners) listener();
}

export function subscribePluginsIncompatibleOnly(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The filter as it stands, re-rendering the caller whenever it flips. */
export function usePluginsIncompatibleOnly(): boolean {
  return useSyncExternalStore(
    subscribePluginsIncompatibleOnly,
    readPluginsIncompatibleOnly,
    readPluginsIncompatibleOnly,
  );
}
