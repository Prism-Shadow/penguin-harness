/**
 * The dashboard's read: every non-archived Session of a Project, as the facts the page counts
 * running and to-review from (the route in http/routes/sessions.ts). Pinned on who may ask,
 * and on the shape an idle Project answers with.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SessionCreateResponse, SessionsOverviewResponse } from "../src/api/types.js";
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

  it("names each Session's Agent and origin, so the page can list them and leave subagents out", async () => {
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    // A Session needs a Model to be created with; the Project has none until it is told one.
    await admin.put("/api/projects/default_project/models", {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }],
    });
    const create = async () => {
      const res = await admin.post(
        "/api/projects/default_project/agents/default_agent/sessions",
        {},
      );
      expect(res.status).toBe(201);
      return ((await res.json()) as SessionCreateResponse).session.sessionId;
    };
    const own = await create();
    const child = await create();
    t.deps.sessionSources.set(child, "subagent");

    const res = await admin.get("/api/projects/default_project/sessions/overview");
    const { sessions } = (await res.json()) as SessionsOverviewResponse;
    const byId = new Map(sessions.map((s) => [s.sessionId, s]));
    expect(byId.get(own)).toMatchObject({
      agentId: "default_agent",
      status: "idle",
      hasTrace: false,
    });
    // No title yet and a user-created origin: both keys absent, not null.
    expect(byId.get(own)).not.toHaveProperty("title");
    expect(byId.get(own)).not.toHaveProperty("source");
    expect(byId.get(child)?.source).toBe("subagent");
  });
});
