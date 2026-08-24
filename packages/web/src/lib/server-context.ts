/**
 * Which SERVER this window's calls go to — the client half of the same-origin proxy.
 *
 * The window always stays on the local origin and the frontend is always served locally;
 * what changes is where the API's root points. With an active server set, every `/api/…`
 * call and SSE subscription is rewritten to `/server/<machineId>/api/…`, which the local
 * server forwards through that machine's tunnel (see the server's machines/proxy.ts). No
 * origin switch, no navigation gate, no per-origin storage split — the remote's cookies
 * live under this origin too, renamed per machine by the proxy.
 *
 * By MACHINE ID, not by ssh alias: an alias is a line in one config file, so keying on it
 * would repoint a window at a different machine the moment someone renamed a host.
 *
 * The choice is per-browser state, read synchronously at every call site. Switching servers
 * is a full document load, like switching accounts — none of one server's in-memory state
 * may survive into another's.
 */

/** localStorage key of the active server's machine id; absent = the local server. */
export const ACTIVE_SERVER_KEY = "penguin.activeServer";

/**
 * The shape a machine id has (16 base64url characters; the longer legacy form is also
 * accepted). Validated on the way OUT of storage rather than trusted: a corrupted or
 * hand-edited value would otherwise be pasted into every request path, and the whole app
 * would answer 503 with nothing to point at. An unrecognisable value reads as "local",
 * which is the state the user can always get back from.
 */
const MACHINE_ID_RE = /^(?:[A-Za-z0-9_-]{16}|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/i;

/** The active server's machine id, or null for the local server. */
export function activeServerId(): string | null {
  try {
    const id = localStorage.getItem(ACTIVE_SERVER_KEY);
    return id !== null && MACHINE_ID_RE.test(id) ? id : null;
  } catch {
    return null; // Storage unavailable: this window is simply on the local server.
  }
}

/** Sets (or clears) the active server. The caller performs the full document load. */
export function setActiveServer(machineId: string | null): void {
  try {
    if (machineId === null) localStorage.removeItem(ACTIVE_SERVER_KEY);
    else localStorage.setItem(ACTIVE_SERVER_KEY, machineId);
  } catch {
    // Storage unavailable: the window simply stays on the local server.
  }
}

/**
 * Where an API path actually goes: re-rooted onto the active server, or as-is for the local
 * one. A pure string mapping used by the fetch wrapper and by every SSE subscription, so
 * the whole app routes through ONE rule rather than each call site remembering.
 */
export function apiUrl(path: string, active: string | null = activeServerId()): string {
  if (active === null || !path.startsWith("/api")) return path;
  return `/server/${encodeURIComponent(active)}${path}`;
}
