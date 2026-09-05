/**
 * The dashboard's rows, decided as data: one per Workspace with something going on, across
 * every server the Project's Sessions live on, ordered so what needs a person comes first.
 *
 * The two counts are the sidebar's own glyph states (lib/session-activity.ts), so the board
 * and the list never disagree: *running* is a live status the server reports, *to review* is
 * a settled Session that ran since this browser last opened it — the same green dot the row
 * wears. Read versus unread is a per-browser fact (lib/session-seen.ts), which is why the
 * server hands over each Session's facts and the counting happens here.
 *
 * A Workspace is a directory ON a machine, so the same path on two machines is two rows, and
 * a row from another machine carries that machine's label. The auto-created temporary
 * Workspaces are one row per machine, as the sidebar groups them — each is single-use, and a
 * row per path would be one-Session noise.
 */
import type { SessionActivityInfo } from "@prismshadow/penguin-server/api";
import { sessionActivity } from "../../lib/session-activity";
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

export interface DashboardRow {
  /** Stable across polls: the machine and the Workspace path. */
  key: string;
  /** The Workspace's last path segment; empty for the merged temporary group, which the page names itself. */
  label: string;
  temporary: boolean;
  /** Which machine the Workspace is on; null when it is this server's — the default needs no saying. */
  machineLabel: string | null;
  running: number;
  pendingReview: number;
}

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
        running: 0,
        pendingReview: 0,
      };
      if (activity === "completedUnread") row.pendingReview += 1;
      else row.running += 1;
      byKey.set(key, row);
    }
    rows.push(...byKey.values());
  }
  // What waits on a person first, then what is busiest; the temporary group after named
  // Workspaces of the same weight, and names in order so the list is stable between polls.
  return rows.sort(
    (a, b) =>
      b.pendingReview - a.pendingReview ||
      b.running - a.running ||
      Number(a.temporary) - Number(b.temporary) ||
      a.label.localeCompare(b.label),
  );
}

/** The header's two numbers: the same counts, over every row. */
export function dashboardTotals(rows: readonly DashboardRow[]): {
  running: number;
  pendingReview: number;
} {
  return rows.reduce(
    (acc, row) => ({
      running: acc.running + row.running,
      pendingReview: acc.pendingReview + row.pendingReview,
    }),
    { running: 0, pendingReview: 0 },
  );
}
