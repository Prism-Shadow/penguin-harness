/**
 * Sessions that are an activity's generation runs belong to that activity: they live in
 * its studio, not in the global session list, and opening one goes back to the activity.
 */
import type { ActivitySummary, SessionInfo } from "@prismshadow/penguin-server/api";
import { latestConversation, withoutOrgSessions } from "./session-grouping";

export function withoutActivityRuns(sessions: readonly SessionInfo[]): SessionInfo[] {
  return sessions.filter((session) => session.activityId === undefined);
}

/** A run's own Workspace, which the server always makes at `<home>/activity-runs/<runId>`. */
export function isActivityRunWorkspace(workspace: string): boolean {
  return /[\\/]activity-runs[\\/]run_[^\\/]+[\\/]?$/.test(workspace.trim());
}

/**
 * Per-Agent per-Workspace server tallies (counts or newest stamps) without the runs' own
 * Workspaces. The server counts activity runs like any conversation, and every run has a
 * Workspace of its own, so without this workspace mode grows one empty group per run.
 */
export function withoutActivityRunWorkspaces<V>(
  byAgent: ReadonlyMap<string, Readonly<Record<string, V>>>,
): Map<string, Record<string, V>> {
  const out = new Map<string, Record<string, V>>();
  for (const [agentId, byWorkspace] of byAgent) {
    out.set(
      agentId,
      Object.fromEntries(
        Object.entries(byWorkspace).filter(([workspace]) => !isActivityRunWorkspace(workspace)),
      ),
    );
  }
  return out;
}

/** What the activity list says about one activity: its card name and its product. */
export interface ActivityLabel {
  name: string;
  productCode: string;
}

export interface ActivityRunGroup {
  activityId: string;
  /** The activity's card name; null while the activity list has not named it. */
  name: string | null;
  /** Its run sessions, most recently active first. */
  sessions: SessionInfo[];
}

export interface ProductRunGroup {
  /** The product code; null for activities the activity list has not named. */
  productCode: string | null;
  /** Its activities, the one with the most recent run first. */
  activities: ActivityRunGroup[];
}

/**
 * The sidebar's "Activity runs" folder: the loaded activity-run sessions under their
 * product code, then under the activity they belong to — at both levels the group with the
 * most recent run first. Archived runs stay in the Archived folder, and an organization's
 * sessions never reach this list.
 */
export function groupActivityRunsByProduct(
  sessions: readonly SessionInfo[],
  labels: ReadonlyMap<string, ActivityLabel>,
): ProductRunGroup[] {
  const names = new Map([...labels].map(([id, label]) => [id, label.name]));
  const byProduct = new Map<string | null, ActivityRunGroup[]>();
  for (const group of groupActivityRuns(sessions, names)) {
    const productCode = labels.get(group.activityId)?.productCode ?? null;
    const activities = byProduct.get(productCode);
    if (activities) activities.push(group);
    else byProduct.set(productCode, [group]);
  }
  // groupActivityRuns already orders activities newest first, so each product's first
  // activity carries its newest run and the products come out in that order too. Runs of
  // activities the list has not identified go last, under a generic heading.
  const products = [...byProduct].map(([productCode, activities]) => ({ productCode, activities }));
  return [
    ...products.filter((p) => p.productCode !== null),
    ...products.filter((p) => p.productCode === null),
  ];
}

/** The loaded activity-run sessions under the activity they belong to, most recent run first. */
export function groupActivityRuns(
  sessions: readonly SessionInfo[],
  names: ReadonlyMap<string, string>,
): ActivityRunGroup[] {
  const byActivity = new Map<string, SessionInfo[]>();
  for (const session of withoutOrgSessions(sessions)) {
    if (session.activityId === undefined || session.archived) continue;
    const rows = byActivity.get(session.activityId);
    if (rows) rows.push(session);
    else byActivity.set(session.activityId, [session]);
  }
  const newestFirst = (a: SessionInfo, b: SessionInfo) =>
    a.lastActiveAt < b.lastActiveAt ? 1 : a.lastActiveAt > b.lastActiveAt ? -1 : 0;
  const groups = [...byActivity].map(([activityId, rows]) => ({
    activityId,
    name: names.get(activityId) ?? null,
    sessions: rows.sort(newestFirst),
  }));
  return groups.sort((a, b) => newestFirst(a.sessions[0]!, b.sessions[0]!));
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
