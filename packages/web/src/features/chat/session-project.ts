import type { SessionInfo } from "@prismshadow/penguin-server/api";

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
