/**
 * The agent browser's live state in this window: a module-level store over the pure reducers in
 * browser-state.ts and browser-servers.ts. A store rather than component state because the
 * readers live far apart — the layer in the app shell hosts the pages, the dock panel draws the
 * strip and the toolbar, the dock's menus ask whether to offer the browser at all, and the
 * conversation's link menu where a link would open.
 *
 * One state per server (browser-servers.ts): every read and every change names the server, null
 * (the default) for this one.
 */
import type { BrowserBackend } from "@prismshadow/penguin-server/api";
import {
  INITIAL_BROWSER_SERVERS,
  anyBrowserOffered,
  reduceServers,
  serverBrowser,
  type BrowserServers,
} from "./browser-servers";
import { linkTarget, type BrowserAction, type BrowserState } from "./browser-state";

let servers: BrowserServers = INITIAL_BROWSER_SERVERS;
const listeners = new Set<() => void>();

/**
 * A server's current state; a new object after every change to it, and the same one while only
 * another server's changed (the useSyncExternalStore snapshot).
 */
export function browserState(server: string | null = null): BrowserState {
  return serverBrowser(servers, server);
}

export function subscribeBrowser(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function dispatchBrowser(action: BrowserAction, server: string | null = null): void {
  const next = reduceServers(servers, server, action);
  if (next === servers) return;
  servers = next;
  for (const listener of [...listeners]) listener();
}

/** Whether the dock offers the browser: some server offers one this window can show. */
export function isBrowserOffered(): boolean {
  return anyBrowserOffered(servers);
}

/** Where a link from a conversation on `server` would open now (browser-state.ts `linkTarget`). */
export function browserLinkTarget(server: string | null = null): BrowserBackend | null {
  return linkTarget(serverBrowser(servers, server));
}
