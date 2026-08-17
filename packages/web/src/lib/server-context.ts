/**
 * Which SERVER this window's calls go to — the client half of the same-origin proxy.
 *
 * The window always stays on the local origin and the frontend is always served locally;
 * what changes is the API's root: with an active server set, every `/api/…` call (and SSE
 * subscription) is rewritten to `/server/<id>/api/…`, which the local platform forwards
 * through that machine's tunnel (see the server's machines/proxy.ts). No origin switch, no
 * navigation gate, no per-origin storage split — the remote's cookies live under this
 * origin too, renamed per machine by the proxy.
 *
 * The choice is per-browser state (localStorage), read synchronously at every call site;
 * switching servers is a full document load, like switching accounts — nothing of one
 * server's in-memory state may survive into another's.
 */

/** localStorage key of the active server id (an ssh alias); absent = the local server. */
export const ACTIVE_SERVER_KEY = "penguin.activeServer";

/** The active server's id, or null for the local server. */
export function activeServerId(): string | null {
  try {
    const id = localStorage.getItem(ACTIVE_SERVER_KEY);
    return id !== null && id !== "" ? id : null;
  } catch {
    return null;
  }
}

/** Sets (or clears) the active server. The caller performs the full document load. */
export function setActiveServer(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(ACTIVE_SERVER_KEY);
    else localStorage.setItem(ACTIVE_SERVER_KEY, id);
  } catch {
    // Storage unavailable: the window simply stays on the local server.
  }
}

/**
 * Where an API path actually goes: prefixed onto the active server, or as-is for the
 * local one. Pure string mapping — used by the fetch wrapper and the SSE subscriptions,
 * so every call in the app routes through one rule.
 */
export function apiUrl(path: string, active: string | null = activeServerId()): string {
  if (active === null || !path.startsWith("/api")) return path;
  return `/server/${encodeURIComponent(active)}${path}`;
}
