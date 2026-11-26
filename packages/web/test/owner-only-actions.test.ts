/**
 * Owner-only writes are offered to the Project's owner alone. The server refuses importing a Trace
 * (`POST /api/projects/:projectId/agents/:agentId/traces/import`) to anyone else with 403
 * (`requireProjectOwner`): a member offered it could only pick the file for a refusal at the end.
 *
 * The Trace import row is checked through the function its Project picker is derived from — the
 * row draws nothing when that function offers no Project.
 */
import { describe, expect, it } from "vitest";
import type { ProjectSummary } from "@prismshadow/penguin-server/api";
import { traceImportTargets } from "../src/features/settings/trace-import-row";

describe("traceImportTargets (the Trace import row's Projects)", () => {
  const project = (projectId: string, role: ProjectSummary["role"]): ProjectSummary => ({
    projectId,
    role,
    ownerUserId: role === "owner" ? "bob" : "alice",
    createdAt: "2026-09-17T00:00:00.000Z",
  });
  /** Alice's Project, shared with Bob as a member. */
  const shared = project("alice-default_project", "member");
  const own = project("bob-default_project", "owner");
  const lab = project("bob-lab", "owner");

  it("offers only the Projects the viewer owns, in the list's order", () => {
    expect(traceImportTargets([shared, own, lab], null, "").projects).toEqual([own, lab]);
  });

  it("starts on the open Project when the viewer owns it, else on the first Project they own", () => {
    expect(traceImportTargets([shared, own, lab], "bob-lab", "").projectId).toBe("bob-lab");
    // Bob is looking at Alice's Project: the row starts on his own rather than on a refusal.
    expect(traceImportTargets([shared, own, lab], "alice-default_project", "").projectId).toBe(
      "bob-default_project",
    );
  });

  it("keeps a pick among the owned Projects, and falls back from one the viewer does not own", () => {
    expect(traceImportTargets([shared, own, lab], "bob-default_project", "bob-lab").projectId).toBe(
      "bob-lab",
    );
    // A pick that is no longer owned (the list reloaded under it) is not kept.
    expect(
      traceImportTargets([shared, own], "bob-default_project", "alice-default_project").projectId,
    ).toBe("bob-default_project");
  });

  it("gives a viewer who owns no Project nothing to import into, which leaves the row undrawn", () => {
    expect(traceImportTargets([shared], "alice-default_project", "")).toEqual({
      projects: [],
      projectId: "",
    });
    expect(traceImportTargets([], null, "")).toEqual({ projects: [], projectId: "" });
  });
});
