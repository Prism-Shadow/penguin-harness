/**
 * Integration tests for Session deletion cleanup: DELETE /api/sessions/:id
 * removes the Session's scratchpad directory (model-generated temp files and
 * input images saved to disk for models without image support) in addition
 * to its Trace and index row.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scratchpadDir } from "@prismshadow/penguin-core";
import type { ProjectCreateResponse, SessionCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("session deletion cleans up the scratchpad", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_s");
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", {
        projectId: "owner_s-scratchpad",
        name: "scratchpad project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }],
    });
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("DELETE removes the session's scratchpad directory along with it", async () => {
    const created = await owner.post(
      `/api/projects/${projectId}/agents/default_agent/sessions`,
      {},
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as SessionCreateResponse;

    // Simulate temp files written during the session (input images / model-generated files).
    const dir = path.join(scratchpadDir(t.root, projectId, "default_agent"), session.sessionId);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, "upload-1.png"), "fake");
    expect(await exists(dir)).toBe(true);

    const del = await owner.delete(`/api/sessions/${session.sessionId}`);
    expect(del.status).toBe(204);
    expect(await exists(dir)).toBe(false);
    // Deleting a session with no scratchpad also succeeds (rm force is idempotent).
    const created2 = await owner.post(
      `/api/projects/${projectId}/agents/default_agent/sessions`,
      {},
    );
    const { session: s2 } = (await created2.json()) as SessionCreateResponse;
    expect((await owner.delete(`/api/sessions/${s2.sessionId}`)).status).toBe(204);
  });

  it("GET /sessions/:id/scratchpad/:file reads per-session files; missing or invalid filenames 404", async () => {
    const created = await owner.post(
      `/api/projects/${projectId}/agents/default_agent/sessions`,
      {},
    );
    const { session } = (await created.json()) as SessionCreateResponse;
    const dir = path.join(scratchpadDir(t.root, projectId, "default_agent"), session.sessionId);
    await fs.mkdir(dir, { recursive: true });
    const png = Buffer.from("89504e470d0a1a0a", "hex"); // just needs the PNG magic bytes
    await fs.writeFile(path.join(dir, "upload-1.png"), png);

    const res = await owner.get(`/api/sessions/${session.sessionId}/scratchpad/upload-1.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(png);

    // Missing files and filenames with path separators/traversal both 404 (no existence leak).
    expect((await owner.get(`/api/sessions/${session.sessionId}/scratchpad/nope.png`)).status).toBe(
      404,
    );
    expect(
      (await owner.get(`/api/sessions/${session.sessionId}/scratchpad/..%2Fsecret.png`)).status,
    ).toBe(404);
  });
});
