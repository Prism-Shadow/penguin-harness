/**
 * The built-in browser's live state in this window: a module-level store over the pure
 * reducer in browser-state.ts. A store rather than component state because the readers live
 * far apart — the layer in the app shell hosts the pages, the dock panel draws the strip and
 * the toolbar, and the dock's menus ask whether to offer the browser at all.
 */
import {
  INITIAL_BROWSER_STATE,
  browserOffered,
  reduceBrowser,
  type BrowserAction,
  type BrowserState,
} from "./browser-state";

let state: BrowserState = INITIAL_BROWSER_STATE;
const listeners = new Set<() => void>();

/** The current state; a new object after every change (the useSyncExternalStore snapshot). */
export function browserState(): BrowserState {
  return state;
}

export function subscribeBrowser(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dispatchBrowser(action: BrowserAction): void {
  const next = reduceBrowser(state, action);
  if (next === state) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

/** Whether the dock offers the browser: this window can host it and the server can drive it. */
export function isBrowserOffered(): boolean {
  return browserOffered(state);
}
