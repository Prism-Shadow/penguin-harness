/**
 * The dashboard's read: every non-archived Session of a Project, as the facts the page counts
 * running and to-review from (the route in http/routes/sessions.ts). Pinned on who may ask,
 * and on the shape an idle Project answers with.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionsOverviewResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

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

  it("answers an idle Project with no Sessions", async () => {
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const res = await admin.get("/api/projects/default_project/sessions/overview");
    expect(res.status).toBe(200);
    expect((await res.json()) as SessionsOverviewResponse).toEqual({ sessions: [] });
  });
});
