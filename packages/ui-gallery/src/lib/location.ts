/**
 * The URL as an external store: components subscribe to `location.search`, and the gallery's
 * controls rewrite it with `history.replaceState` (a view tweak is not a history entry) and keep
 * the hash, so the section in view stays put.
 */
import { useSyncExternalStore } from "react";

const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  window.addEventListener("popstate", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("popstate", listener);
  };
}

export function useSearch(): string {
  return useSyncExternalStore(subscribe, () => window.location.search);
}

export function replaceSearch(search: string): void {
  if (search === window.location.search) return;
  const { pathname, hash } = window.location;
  window.history.replaceState(window.history.state, "", `${pathname}${search}${hash}`);
  for (const listener of listeners) listener();
}

/** `import.meta.env.BASE_URL` without its trailing slash, so `${base}/embed` works at any base. */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** The route path with the base stripped: `/`, `/embed`, `/screens/chat`, `/fonts`. */
export function routePath(): string {
  const path = window.location.pathname;
  const rest = BASE && path.startsWith(BASE) ? path.slice(BASE.length) : path;
  return rest === "" ? "/" : rest.replace(/\/+$/, "") || "/";
}

export function absoluteUrl(path: string): string {
  return `${window.location.origin}${BASE}${path}`;
}

function subscribeDark(listener: () => void): () => void {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

export function usePrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeDark,
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
}
