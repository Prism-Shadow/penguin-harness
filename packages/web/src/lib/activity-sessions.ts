/**
 * Sessions that are an activity's generation runs belong to that activity: they live in
 * its studio, not in the global session list, and opening one goes back to the activity.
 */
import type { SessionInfo } from "@prismshadow/penguin-server/api";

export function withoutActivityRuns(sessions: readonly SessionInfo[]): SessionInfo[] {
  return sessions.filter((session) => session.activityId === undefined);
}

export function sessionHref(session: Pick<SessionInfo, "sessionId" | "activityId">): string {
  return session.activityId !== undefined
    ? `/activities/${encodeURIComponent(session.activityId)}`
    : `/chat/${encodeURIComponent(session.sessionId)}`;
}

const LIVE = new Set(["running", "compacting"]);

/** `before` is sessionId -> the status last seen. */
export function settledActivityRuns(
  before: ReadonlyMap<string, string>,
  sessions: readonly SessionInfo[],
): boolean {
  return sessions.some(
    (session) =>
      session.activityId !== undefined &&
      LIVE.has(before.get(session.sessionId) ?? "") &&
      !LIVE.has(session.status),
  );
}

/**
 * The list can go stale while the user is inside an activity's own workspace: a run may
 * settle there (its session leaves the "live" set) without the list-level effect ever
 * seeing it, because that effect only fires while `!activityId`. Returning to the list is
 * therefore itself a reason to reload — but only a genuine return from an activity, not the
 * list's own first mount (`prevActivityId` starts undefined) and not while still inside one.
 */
export function shouldReloadList(
  prevActivityId: string | undefined,
  activityId: string | undefined,
): boolean {
  return prevActivityId !== undefined && activityId === undefined;
}
