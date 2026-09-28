/**
 * A session's `activityId`: SessionsRepo maps activity-run sessions to the activity whose run
 * they are, project-wide (activityIdsOfProject, the session list's one-query path) and per
 * session (activityIdOfSession). Only rows the record names as their session count, and a
 * session belonging to another project's activity run never appears in this project's map.
 */
import { describe, expect, it } from "vitest";
import type { ActivityDetail } from "../src/activities/domain.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";

describe("session -> activity", () => {
  it("maps a project's activity-run sessions to their activity, and nothing else", async () => {
    const t = await createTestApp();
    try {
      const owner = await provisionUser(t.app, "activity_session_owner");
      const client = apiClient(t.app, owner.cookie);
      const p1 = "activity_session_owner-p1";
      const p2 = "activity_session_owner-p2";

      expect((await client.post("/api/projects", { projectId: p1 })).status).toBe(201);
      expect((await client.post("/api/projects", { projectId: p2 })).status).toBe(201);

      const createActivity = async (projectId: string, refNum: number): Promise<ActivityDetail> => {
        const response = await client.post(`/api/projects/${projectId}/activities`, {
          productCode: "words",
          refNum,
          title: `words ${refNum}`,
        });
        expect(response.status, await response.clone().text()).toBe(201);
        return (await response.json()) as ActivityDetail;
      };

      const act1 = await createActivity(p1, 1);
      const act9 = await createActivity(p2, 9);

      const insert = t.deps.db.prepare(
        "INSERT INTO activity_runs (run_id, project_id, activity_id, status, created_at, kind, record_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      insert.run("run_1", p1, act1.id, "succeeded", "2026-09-28", "spec", JSON.stringify({ sessionId: "s1" }));
      insert.run("run_2", p1, act1.id, "succeeded", "2026-09-28", "audio", JSON.stringify({ sessionId: null }));
      insert.run("run_3", p2, act9.id, "succeeded", "2026-09-28", "spec", JSON.stringify({ sessionId: "s9" }));

      const repo = t.deps.sessionsRepo;
      expect([...repo.activityIdsOfProject(p1)]).toEqual([["s1", act1.id]]);
      expect(repo.activityIdOfSession("s1")).toBe(act1.id);
      expect(repo.activityIdOfSession("s-unknown")).toBeUndefined();
      // A session belonging to another project's activity run never appears in this project's map.
      expect(repo.activityIdsOfProject(p1).has("s9")).toBe(false);
    } finally {
      await t.cleanup();
    }
  });
});
