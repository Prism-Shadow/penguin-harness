/**
 * Addressing another machine's API from this window, per call.
 *
 * The window is always on the local server and the frontend is always served locally. A call
 * that names a machine is rewritten to `/server/<machineId>/api/…`, which the local server
 * forwards through that machine's tunnel (see the server's machines/proxy.ts). Browsing a
 * remote machine's directories to pick a workspace on it is what this exists for.
 *
 * There is deliberately NO window-wide "active server" mode. One existed and was removed:
 * pointing an entire window at another machine put every page behind a tunnel, including
 * `/api/me` — so a tunnel that dropped left the app unable to answer whether anyone was
 * logged in, and the control for getting back was rendered inside the layout that never
 * mounted. An escape hatch behind the thing that breaks is not an escape hatch. Naming the
 * machine on the calls that actually concern it has no such failure: a dead tunnel breaks
 * exactly the request that needed it, and says so.
 */

/**
 * Where an API path goes: re-rooted onto `machineId`, or as-is for the local server. A pure
 * string mapping, used by the fetch wrapper and the SSE subscriptions so one rule covers
 * every call.
 */
export function apiUrl(path: string, machineId: string | null = null): string {
  if (machineId === null || !path.startsWith("/api")) return path;
  return `/server/${encodeURIComponent(machineId)}${path}`;
}
