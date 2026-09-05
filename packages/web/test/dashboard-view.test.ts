/**
 * dashboard-view unit tests: the rows the dashboard shows, from the per-server answers.
 * Pinned: the counts are the sidebar's glyph states — running is a live status, to review is
 * a settled Session unread in this browser — a Workspace is per machine, temporary Workspaces
 * merge into one row per machine, and the order puts what waits on a person first.
 */
import { describe, expect, it } from "vitest";
import type { SessionActivityInfo } from "@prismshadow/penguin-server/api";
import { dashboardRows, dashboardTotals } from "../src/features/dashboard/dashboard-view";
import type { SessionSeenState } from "../src/lib/session-seen";

/** This browser first saw the Project on the 1st and last opened `s-read` on the 5th. */
const seen: SessionSeenState = {
  seededAt: Date.parse("2026-09-01T00:00:00.000Z"),
  seen: new Map([["s-read", Date.parse("2026-09-05T00:00:00.000Z")]]),
};

let n = 0;
const session = (
  workspace: string,
  status: SessionActivityInfo["status"],
  over: Partial<SessionActivityInfo> = {},
): SessionActivityInfo => ({
  sessionId: `s-${++n}`,
  workspace,
  status,
  hasTrace: true,
  lastActiveAt: "2026-09-04T12:00:00.000Z",
  ...over,
});

const local = (sessions: SessionActivityInfo[]) => ({
  machineId: null,
  machineLabel: "here",
  local: true,
  sessions,
});

describe("dashboardRows", () => {
  it("counts a live status as running and a settled, unread Session as to review — and nothing else", () => {
    const rows = dashboardRows(
      [
        local([
          session("/home/u/proj", "running"),
          session("/home/u/proj", "compacting"),
          // Finished after this browser first saw the Project, never opened since: unread.
          session("/home/u/proj", "idle"),
          // Opened on the 5th, last ran on the 3rd: read.
          session("/home/u/proj", "idle", {
            sessionId: "s-read",
            lastActiveAt: "2026-09-03T00:00:00.000Z",
          }),
          // Never ran: nothing to review, whatever its timestamps say.
          session("/home/u/proj", "idle", { hasTrace: false }),
          // Idle and last active before the browser knew the Project: silent.
          session("/home/u/other", "idle", { lastActiveAt: "2026-08-20T00:00:00.000Z" }),
        ]),
      ],
      seen,
    );
    expect(rows).toEqual([
      {
        key: "\0/home/u/proj",
        label: "proj",
        temporary: false,
        machineLabel: null,
        running: 2,
        pendingReview: 1,
      },
    ]);
  });

  it("orders by to review, then running, then name, and merges temporary Workspaces", () => {
    const rows = dashboardRows(
      [
        local([
          session("/home/u/proj-b", "running"),
          session("/home/u/proj-b", "running"),
          session("/home/u/proj-a", "running"),
          session("/home/u/proj-a", "running"),
          session("/home/u/quiet", "idle"),
          session("/agents/x/workspaces/tmp-0123abcd", "running"),
          session("/agents/x/workspaces/tmp-89abcdef", "idle"),
        ]),
      ],
      seen,
    );
    expect(rows.map((r) => [r.temporary ? "(temp)" : r.label, r.running, r.pendingReview])).toEqual(
      [
        ["(temp)", 1, 1],
        ["quiet", 0, 1],
        ["proj-a", 2, 0],
        ["proj-b", 2, 0],
      ],
    );
  });

  it("keeps the same path on two machines apart, and names the machine only when it is not this one", () => {
    const rows = dashboardRows(
      [
        local([session("/srv/app", "running")]),
        {
          machineId: "m1",
          machineLabel: "nas",
          local: false,
          sessions: [session("/srv/app", "idle")],
        },
      ],
      seen,
    );
    expect(rows.map((r) => [r.label, r.machineLabel, r.key])).toEqual([
      ["app", "nas", "m1\0/srv/app"],
      ["app", null, "\0/srv/app"],
    ]);
  });

  it("totals are the same counts over every row", () => {
    const rows = dashboardRows(
      [local([session("/a", "running"), session("/a", "idle"), session("/b", "running")])],
      seen,
    );
    expect(dashboardTotals(rows)).toEqual({ running: 2, pendingReview: 1 });
    expect(dashboardTotals([])).toEqual({ running: 0, pendingReview: 0 });
  });
});
