/**
 * Sessions that are an activity's generation runs belong to that activity: they live in
 * its studio, not in the global session list, and opening one goes back to the activity.
 */
import type { ActivitySummary, SessionInfo } from "@prismshadow/penguin-server/api";
import { latestConversation, withoutOrgSessions } from "./session-grouping";

export function withoutActivityRuns(sessions: readonly SessionInfo[]): SessionInfo[] {
  return sessions.filter((session) => session.activityId === undefined);
}

/**
 * The conversation the app opens by itself (the chat page's auto-select, the rail's
 * last-conversation entry): never an organization's session, never an activity's run.
 * One helper so the two entry points cannot drift apart.
 */
export function latestOwnConversation(sessions: readonly SessionInfo[]): SessionInfo | null {
  return latestConversation(withoutActivityRuns(withoutOrgSessions(sessions)));
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
 * A run this tab has no row for — started from another tab after the list loaded — reaches
 * the store only as a live status, so `settledActivityRuns` never sees it settle and no
 * summary says "running" to start the poll. Its start is the signal instead: a session this
 * list does not hold going live may be an activity run, and one reload tells.
 */
export function startedUnlistedRuns(
  before: ReadonlyMap<string, string>,
  live: ReadonlyMap<string, string>,
  sessions: readonly Pick<SessionInfo, "sessionId">[],
): boolean {
  const listed = new Set(sessions.map((session) => session.sessionId));
  for (const [sessionId, status] of live) {
    if (LIVE.has(status) && !LIVE.has(before.get(sessionId) ?? "") && !listed.has(sessionId))
      return true;
  }
  return false;
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

/** How often the home list re-reads its summaries while a run is in flight. */
export const RUNNING_POLL_MS = 5000;

/**
 * Whether the home list should poll: only while the list itself is shown (no activity open)
 * and some activity's summary says a run is in flight. A run started after the sessions store
 * loaded never reaches the store's settle signal, so polling is what notices it finishing.
 */
export function shouldPollSummaries(
  activityId: string | undefined,
  summaries: Readonly<Record<string, Pick<ActivitySummary, "status">>>,
): boolean {
  if (activityId !== undefined) return false;
  return Object.values(summaries).some((summary) => summary.status.kind === "running");
}
