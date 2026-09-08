/**
 * The dashboard's rows, decided as data: one per Workspace with something going on, across
 * every server the Project's Sessions live on, ordered so what needs a person comes first.
 *
 * The two lists are the sidebar's own glyph states (lib/session-activity.ts), so the board
 * and the list never disagree: *running* is a live status the server reports, *to review* is
 * a settled Session that ran since this browser last opened it — the same green dot the row
 * wears. Read versus unread is a per-browser fact (lib/session-seen.ts), which is why the
 * server hands over each Session's facts and the counting happens here.
 *
 * A subagent Session is left out of both. It belongs to the conversation that spawned it: the
 * sidebar keeps it in a folder closed by default, and a person reads it from the parent's
 * Agents panel — so a count that included it could never be brought down from the sidebar,
 * and a running one would count the same work twice.
 *
 * A Workspace is a directory ON a machine, so the same path on two machines is two rows, and
 * a row from another machine carries that machine's label. The auto-created temporary
 * Workspaces are one row per machine, as the sidebar groups them — each is single-use, and a
 * row per path would be one-Session noise.
 */
import type { SessionActivityInfo } from "@prismshadow/penguin-server/api";
import { sessionActivity } from "../../lib/session-activity";
import type { SessionActivity } from "../../lib/session-activity";
import { isSessionUnread } from "../../lib/session-seen";
import type { SessionSeenState } from "../../lib/session-seen";
import { isTempWorkspace, workspaceLabel } from "../../lib/session-grouping";

/** One server's answer, with the machine it came from. */
export interface DashboardSource {
  /** The machine's own id; null for the server serving this page. */
  machineId: string | null;
  /** The ssh alias, or this host's name for the local entry. */
  machineLabel: string;
  local: boolean;
  sessions: readonly SessionActivityInfo[];
}

/** One line of a row's unfolded list: enough to name the Session and to open it. */
export interface DashboardSession {
  sessionId: string;
  /** The machine it lives on; null for this server. Recorded before opening, so the chat page's calls reach the machine that has it. */
  machineId: string | null;
  agentId: string;
  /** The Session's title; null while none has been generated (the page names it as the sidebar does). */
  title: string | null;
  lastActiveAt: string;
  /** The glyph it wears: a live state, or the settled-unread dot. */
  activity: Exclude<SessionActivity, null>;
}

export interface DashboardRow {
  /** Stable across polls: the machine and the Workspace path. */
  key: string;
  /** The Workspace's last path segment; empty for the merged temporary group, which the page names itself. */
  label: string;
  temporary: boolean;
  /** Which machine the Workspace is on; null when it is this server's — the default needs no saying. */
  machineLabel: string | null;
  /** Sessions with a live status, most recently active first. */
  running: DashboardSession[];
  /** Settled Sessions unread in this browser, most recently active first. */
  pendingReview: DashboardSession[];
}

/** Most recently active first; the id breaks ties so the order is the same on every poll. */
const latestFirst = (a: DashboardSession, b: DashboardSession) =>
  b.lastActiveAt.localeCompare(a.lastActiveAt) || a.sessionId.localeCompare(b.sessionId);

export function dashboardRows(
  sources: readonly DashboardSource[],
  seen: SessionSeenState,
): DashboardRow[] {
  const rows: DashboardRow[] = [];
  for (const source of sources) {
    const machineLabel = source.local ? null : source.machineLabel;
    const prefix = `${source.machineId ?? ""}\0`;
    const byKey = new Map<string, DashboardRow>();
    for (const s of source.sessions) {
      if (s.source === "subagent") continue;
      const activity = sessionActivity(
        s.status,
        s.hasTrace,
        isSessionUnread(seen, s.sessionId, s.lastActiveAt),
      );
      if (activity === null) continue;
      const temporary = isTempWorkspace(s.workspace);
      const key = temporary ? `${prefix}temp` : `${prefix}${s.workspace}`;
      const row = byKey.get(key) ?? {
        key,
        label: temporary ? "" : workspaceLabel(s.workspace),
        temporary,
        machineLabel,
        running: [],
        pendingReview: [],
      };
      const line: DashboardSession = {
        sessionId: s.sessionId,
        machineId: source.machineId,
        agentId: s.agentId,
        title: s.title ?? null,
        lastActiveAt: s.lastActiveAt,
        activity,
      };
      (activity === "completedUnread" ? row.pendingReview : row.running).push(line);
      byKey.set(key, row);
    }
    for (const row of byKey.values()) {
      row.running.sort(latestFirst);
      row.pendingReview.sort(latestFirst);
    }
    rows.push(...byKey.values());
  }
  // What waits on a person first, then what is busiest; the temporary group after named
  // Workspaces of the same weight, and names in order so the list is stable between polls.
  return rows.sort(
    (a, b) =>
      b.pendingReview.length - a.pendingReview.length ||
      b.running.length - a.running.length ||
      Number(a.temporary) - Number(b.temporary) ||
      a.label.localeCompare(b.label),
  );
}

/** The header's two numbers: the same lists, counted over every row. */
export function dashboardTotals(rows: readonly DashboardRow[]): {
  running: number;
  pendingReview: number;
} {
  return rows.reduce(
    (acc, row) => ({
      running: acc.running + row.running.length,
      pendingReview: acc.pendingReview + row.pendingReview.length,
    }),
    { running: 0, pendingReview: 0 },
  );
}
