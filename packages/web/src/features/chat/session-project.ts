import type { SessionInfo } from "@prismshadow/penguin-server/api";

/**
 * The Session the route names: the loaded list's row when it holds one, otherwise the row a
 * direct lookup produced.
 *
 * Both halves are load-bearing. The list is paged, so a deep-linked conversation may sit
 * beyond the fetched pages; and it is replaced wholesale by every reload, which drops a row
 * that was merged in by such a lookup — an organization's desk, opened from the org chart,
 * is exactly that row, and losing it again is what left the conversation behind the skeleton
 * for good. The list row still WINS where it exists: it is the one the status and title
 * events keep current.
 */
export function resolveRoutedSession(
  sessionId: string | null,
  sessions: readonly SessionInfo[],
  fetched: SessionInfo | null,
): SessionInfo | null {
  if (sessionId === null) return null;
  const row = sessions.find((s) => s.sessionId === sessionId);
  if (row !== undefined) return row;
  return fetched !== null && fetched.sessionId === sessionId ? fetched : null;
}

/** Return a probed Session only when it belongs to the Project currently shown by the UI. */
export function sessionForProject(session: SessionInfo, projectId: string): SessionInfo | null {
  return session.projectId === projectId ? session : null;
}

/** Scope probe failures to a Project as well as a Session so switching Projects cannot reuse one. */
export function sessionProbeKey(projectId: string, sessionId: string): string {
  return `${projectId}:${sessionId}`;
}

/**
 * What the chat page should go on showing for the routed Session, given what the list says
 * right now — the previous answer, held, when the list has momentarily stopped naming it.
 *
 * The Session list is rebuilt WHOLESALE by every refetch, so "not in the list" is two very
 * different facts wearing one face: the row is gone, or the array on hand is one tick old.
 * A source that answers slower than its siblings, a machine that misses a round, a Session
 * whose category changed under a page that is not loaded — all of them un-name a live
 * conversation for a tick. Taking that for "gone" is what paints the skeleton over a
 * conversation being read; holding the last answer through it is what this is for.
 *
 * The hold is released the moment either thing that could make it a LIE happens: the route
 * moved to another Session, or the direct lookup came back and said this one is not there.
 * So a deleted Session still leaves the screen — one tick later than it used to.
 */
export function heldRouteSession(
  held: SessionInfo | null,
  listed: SessionInfo | null,
  routeSessionId: string | null,
  probeSaysGone: boolean,
): SessionInfo | null {
  if (listed !== null) return listed;
  if (held === null || held.sessionId !== routeSessionId) return null;
  return probeSaysGone ? null : held;
}

/**
 * What the chat page does about the routed Session once the list has loaded.
 *
 * - `show`: a row is on screen.
 * - `wait`: the route names a Session no source has answered for yet (paged out, just created,
 *   a machine out of reach) — the skeleton, or the offline note, stays up.
 * - `redirect`: open the latest conversation, or the draft when there is none. That is what a
 *   route naming no Session means, what deleting the conversation on screen means (the row is
 *   gone on purpose), and what a Session of another Project means (a Project switch leaves the
 *   old route behind).
 * - `notFound`: the server said the Session does not exist — a stale link, a desk whose Agent
 *   was deleted, a conversation deleted in another tab. The page says so in place. Opening the
 *   latest conversation instead put the reader in an unrelated one under the dead link's
 *   pretence, which is exactly what a click on a deleted employee's desk used to do.
 */
export type RouteSessionOutcome = "show" | "wait" | "redirect" | "notFound";

export function routeSessionOutcome(state: {
  /** A row for the route is on screen (listed, looked up, or held through a refetch). */
  shown: boolean;
  /** The route names a Session nobody has answered for yet. */
  pending: boolean;
  routeSessionId: string | null;
  /** The Session was deleted from this page. */
  deletedHere: boolean;
  /** The direct lookup answered 404: no such Session, or none this user may see. */
  missing: boolean;
}): RouteSessionOutcome {
  if (state.shown) return "show";
  if (state.pending) return "wait";
  if (state.routeSessionId === null || state.deletedHere || !state.missing) return "redirect";
  return "notFound";
}
