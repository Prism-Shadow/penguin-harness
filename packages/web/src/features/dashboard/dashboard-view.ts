/**
 * The dashboard's rows, decided as data: one per Workspace with something going on, across
 * every server the Project's Sessions live on, ordered so what needs a person comes first.
 *
 * A Workspace is a directory ON a machine, so the same path on two machines is two rows, and
 * a row from another machine carries that machine's label. The auto-created temporary
 * Workspaces are one row per machine, as the sidebar groups them — each is single-use, and a
 * row per path would be one-Session noise.
 */
import type { WorkspaceActivity } from "@prismshadow/penguin-server/api";
import { isTempWorkspace, workspaceLabel } from "../../lib/session-grouping";

/** One server's answer, with the machine it came from. */
export interface DashboardSource {
  /** The machine's own id; null for the server serving this page. */
  machineId: string | null;
  /** The ssh alias, or this host's name for the local entry. */
  machineLabel: string;
  local: boolean;
  workspaces: readonly WorkspaceActivity[];
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

export function dashboardRows(sources: readonly DashboardSource[]): DashboardRow[] {
  const rows: DashboardRow[] = [];
  for (const source of sources) {
    const machineLabel = source.local ? null : source.machineLabel;
    const prefix = `${source.machineId ?? ""}\0`;
    const temp = { running: 0, pendingReview: 0 };
    for (const w of source.workspaces) {
      if (isTempWorkspace(w.workspace)) {
        temp.running += w.running;
        temp.pendingReview += w.pendingReview;
        continue;
      }
      rows.push({
        key: `${prefix}${w.workspace}`,
        label: workspaceLabel(w.workspace),
        temporary: false,
        machineLabel,
        running: w.running,
        pendingReview: w.pendingReview,
      });
    }
    if (temp.running + temp.pendingReview > 0) {
      rows.push({ key: `${prefix}temp`, label: "", temporary: true, machineLabel, ...temp });
    }
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
