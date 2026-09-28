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
