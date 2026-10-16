/**
 * Safe mode: the app runs without anything the server contributes, so a contribution that
 * breaks the UI can be stepped around and the harness rolled back. The one place that reads
 * it is the contributions consumer (web-app/contributions.tsx); the rescue panel enters it, the
 * marker and the command palette leave it.
 *
 * The switch lives in sessionStorage, not in the URL. An in-app navigation drops the query
 * string, and safe mode has to hold across navigations and a reload until the user leaves it;
 * sessionStorage does that and still ends with the tab, so a forgotten safe mode does not
 * follow the user into a new one. `?safe` is the way in from outside — a typed address, or a
 * tab whose app is too broken to offer the button: the entry adopts it before the first render
 * and drops it from the address, or a reload after leaving would enter again.
 *
 * Storage can be missing or throw (a sandboxed frame, a locked-down browser); the switch then
 * lives in memory for the life of the page, which still covers everything but a reload.
 */
import { useSyncExternalStore } from "react";

const KEY = "penguin.safeMode";
/** The query parameter that enters safe mode: `?safe`. */
export const SAFE_PARAM = "safe";

let on: boolean | null = null;
const listeners = new Set<() => void>();

function stored(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function isSafeMode(): boolean {
  if (on === null) on = stored();
  return on;
}

export function setSafeMode(next: boolean): void {
  try {
    if (next) sessionStorage.setItem(KEY, "1");
    else sessionStorage.removeItem(KEY);
  } catch {
    // Memory alone: see the header.
  }
  if (isSafeMode() === next) return;
  on = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether safe mode is on, redrawn when it changes. */
export function useSafeMode(): boolean {
  return useSyncExternalStore(subscribe, isSafeMode, isSafeMode);
}

/**
 * Enters safe mode when the address carries `?safe`, and takes the parameter out of the
 * address without a navigation. Called once by the entry, before the router reads the URL.
 */
export function adoptSafeModeParam(
  loc: Pick<Location, "href"> = window.location,
  hist: Pick<History, "state" | "replaceState"> = window.history,
): void {
  const url = new URL(loc.href);
  if (!url.searchParams.has(SAFE_PARAM)) return;
  setSafeMode(true);
  url.searchParams.delete(SAFE_PARAM);
  hist.replaceState(hist.state, "", `${url.pathname}${url.search}${url.hash}`);
}
