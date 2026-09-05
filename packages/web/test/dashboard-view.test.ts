/**
 * dashboard-view unit tests: the rows the dashboard shows, from the per-server answers.
 * Pinned: a Workspace is per machine, temporary Workspaces merge into one row per machine,
 * and the order puts what waits on a person first.
 */
import { describe, expect, it } from "vitest";
import { dashboardRows, dashboardTotals } from "../src/features/dashboard/dashboard-view";

const local = (workspaces: Parameters<typeof dashboardRows>[0][number]["workspaces"]) => ({
  machineId: null,
  machineLabel: "here",
  local: true,
  workspaces,
});

describe("dashboardRows", () => {
  it("orders by pending review, then running, then name, and merges temporary Workspaces", () => {
    const rows = dashboardRows([
      local([
        { workspace: "/home/u/proj-b", running: 2, pendingReview: 0 },
        { workspace: "/home/u/proj-a", running: 2, pendingReview: 0 },
        { workspace: "/home/u/quiet", running: 0, pendingReview: 1 },
        { workspace: "/agents/x/workspaces/tmp-0123abcd", running: 1, pendingReview: 0 },
        { workspace: "/agents/x/workspaces/tmp-89abcdef", running: 0, pendingReview: 1 },
      ]),
    ]);
    expect(rows.map((r) => [r.temporary ? "(temp)" : r.label, r.running, r.pendingReview])).toEqual(
      [
        ["(temp)", 1, 1],
        ["quiet", 0, 1],
        ["proj-a", 2, 0],
        ["proj-b", 2, 0],
      ],
    );
    expect(rows.every((r) => r.machineLabel === null)).toBe(true);
  });

  it("keeps the same path on two machines apart, and names the machine only when it is not this one", () => {
    const rows = dashboardRows([
      local([{ workspace: "/srv/app", running: 1, pendingReview: 0 }]),
      {
        machineId: "m1",
        machineLabel: "nas",
        local: false,
        workspaces: [{ workspace: "/srv/app", running: 0, pendingReview: 1 }],
      },
    ]);
    expect(rows.map((r) => [r.label, r.machineLabel, r.key])).toEqual([
      ["app", "nas", "m1\0/srv/app"],
      ["app", null, "\0/srv/app"],
    ]);
  });

  it("totals are the same counts over every row", () => {
    const rows = dashboardRows([
      local([
        { workspace: "/a", running: 2, pendingReview: 1 },
        { workspace: "/b", running: 1, pendingReview: 0 },
      ]),
    ]);
    expect(dashboardTotals(rows)).toEqual({ running: 3, pendingReview: 1 });
    expect(dashboardTotals([])).toEqual({ running: 0, pendingReview: 0 });
  });
});
