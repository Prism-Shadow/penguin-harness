/**
 * Whether the reader asked their system to reduce motion, as live state.
 *
 * `styles.css` already disables the app's CSS animations under that preference, so this hook is
 * for what CSS cannot reach on its own: motion driven frame by frame in JS, and the one
 * disclosure that has to know whether the keyframes are running at all (truncated.tsx, #570).
 * Its callers replace the animation with the resting state it would have ended on — the sheet
 * snaps to its target, the dock launcher's ball jumps home and its fan opens and folds without
 * one.
 *
 * One query and one listener for the whole app rather than one per component: `Truncated` reads
 * this from every truncating row, and per-row media-query subscriptions are exactly what the
 * scroll reveal was built to avoid (#309). Reading through `useSyncExternalStore` also closes
 * the window a useState/useEffect pair leaves open, in which a change landing between the first
 * render and the effect is never seen. The window guard keeps the module importable outside a
 * browser, since the query is opened at import time.
 */
import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

const query =
  typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(QUERY)
    : null;

const listeners = new Set<() => void>();

query?.addEventListener("change", () => {
  for (const notify of listeners) notify();
});

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

function prefersReducedMotion(): boolean {
  return query?.matches ?? false;
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, prefersReducedMotion, prefersReducedMotion);
}
