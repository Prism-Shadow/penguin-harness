/**
 * The dashboard's read: per Workspace, how many Sessions run and how many wait on an
 * approval (services/session-overview.ts, and its route). The counting is pinned on plain
 * facts; the route is pinned on who may ask and on the shape an idle Project answers with.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionsOverviewResponse } from "../src/api/types.js";
import { workspaceActivityOf } from "../src/services/session-overview.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("workspaceActivityOf", () => {
  it("counts running and pending review per Workspace, one Session possibly as both", () => {
    const rows = workspaceActivityOf([
      { workspace: "/w/a", status: "running", pendingApprovalCount: 0, archived: false },
      { workspace: "/w/a", status: "compacting", pendingApprovalCount: 0, archived: false },
      { workspace: "/w/a", status: "running", pendingApprovalCount: 2, archived: false },
      { workspace: "/w/b", status: "idle", pendingApprovalCount: 1, archived: false },
    ]);
    expect(rows).toEqual([
      { workspace: "/w/a", running: 3, pendingReview: 1 },
      { workspace: "/w/b", running: 0, pendingReview: 1 },
    ]);
  });

  it("leaves out idle Workspaces and archived rows — settled is not activity", () => {
    expect(
      workspaceActivityOf([
        { workspace: "/w/idle", status: "idle", pendingApprovalCount: 0, archived: false },
        { workspace: "/w/gone", status: "running", pendingApprovalCount: 1, archived: true },
      ]),
    ).toEqual([]);
  });
});

describe("GET /api/projects/:projectId/sessions/overview", () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("needs a session, and answers only for a Project the user can see", async () => {
    expect((await t.app.request("/api/projects/default_project/sessions/overview")).status).toBe(
      401,
    );
    const stranger = await provisionUser(t.app, "stranger");
    expect(
      (
        await apiClient(t.app, stranger.cookie).get(
          "/api/projects/default_project/sessions/overview",
        )
      ).status,
    ).toBe(404);
  });

  it("answers an idle Project with no Workspaces", async () => {
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const res = await admin.get("/api/projects/default_project/sessions/overview");
    expect(res.status).toBe(200);
    expect((await res.json()) as SessionsOverviewResponse).toEqual({ workspaces: [] });
  });
});
