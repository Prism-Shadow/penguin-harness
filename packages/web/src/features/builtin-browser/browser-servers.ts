/**
 * The agent browser's state, one per server: this server's, and each machine's whose browser
 * this window has been told about. A conversation's Browser panel shows the browser of the
 * server its Workspace lives on, where the agent's `penguin browser` runs, so a machine's tabs,
 * activity and backend never mix with this server's.
 *
 * A server is named as the API names it: null for this one, a machine id otherwise
 * (lib/server-context.ts). A machine's state starts as an empty one and is filled by its own
 * status and its own user-channel events; this window hosts no `<webview>` page for it, so it is
 * never `supported` there and its built-in browser is never the one shown.
 */
import {
  INITIAL_BROWSER_STATE,
  browserOffered,
  reduceBrowser,
  type BrowserAction,
  type BrowserState,
} from "./browser-state";

export interface BrowserServers {
  /** This server's browser. */
  readonly hub: BrowserState;
  /** Each machine's, by machine id. */
  readonly machines: Readonly<Record<string, BrowserState>>;
}

export const INITIAL_BROWSER_SERVERS: BrowserServers = {
  hub: INITIAL_BROWSER_STATE,
  machines: {},
};

/** A server's browser as this window knows it; an empty state for a machine it has not heard of. */
export function serverBrowser(servers: BrowserServers, server: string | null): BrowserState {
  if (server === null) return servers.hub;
  return servers.machines[server] ?? INITIAL_BROWSER_STATE;
}

/** One action applied to one server's state; every other server's state is the same object after. */
export function reduceServers(
  servers: BrowserServers,
  server: string | null,
  action: BrowserAction,
): BrowserServers {
  const before = serverBrowser(servers, server);
  const after = reduceBrowser(before, action);
  if (after === before) return servers;
  return server === null
    ? { ...servers, hub: after }
    : { ...servers, machines: { ...servers.machines, [server]: after } };
}

/** Whether the dock offers the Browser panel: some server this window knows offers a browser. */
export function anyBrowserOffered(servers: BrowserServers): boolean {
  return browserOffered(servers.hub) || Object.values(servers.machines).some(browserOffered);
}
