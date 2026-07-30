/**
 * PATCH /api/projects/:projectId — renaming a Project's display name.
 *
 * The display name is the only mutable field of a Project: the id names the directory, the
 * Workspace paths and every stored reference, so it stays immutable and there is no route that
 * changes it. These tests pin the three things that could quietly go wrong: who is allowed to
 * rename (owner only, with a non-member unable to tell the Project exists), that the write is a
 * read-modify-write of project_config.toml rather than a replacement — models and their
 * credentials must survive a rename — and that a blank name is refused rather than stored.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ModelsResponse,
  ProjectCreateResponse,
  ProjectUpdateResponse,
  ProjectsResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("project rename", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-shared", name: "Before" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("owner renames: the response, the Project list and the toml all carry the new name", async () => {
    const res = await owner.patch(`/api/projects/${projectId}`, { name: "After" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as ProjectUpdateResponse).project).toMatchObject({
      projectId,
      name: "After",
      role: "owner",
    });

    const list = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    expect(list.projects.find((p) => p.projectId === projectId)?.name).toBe("After");

    const toml = await fs.readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain('name = "After"');
    expect(toml).not.toContain("Before");
  });

  it("keeps models and their credentials — the write is read-modify-write, not a replacement", async () => {
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "custom", modelId: "m-1" },
      models: [{ provider: "custom", modelId: "m-1", apiKey: "sk-super-secret-key-123456" }],
    });
    expect(put.status).toBe(200);

    expect((await owner.patch(`/api/projects/${projectId}`, { name: "Renamed" })).status).toBe(200);

    const models = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    expect(models.defaultModel).toEqual({ provider: "custom", modelId: "m-1" });
    expect(models.models).toHaveLength(1);
    // The key is masked on read, so assert on the file: a replacing write would have dropped it.
    const toml = await fs.readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain("sk-super-secret-key-123456");
    expect(toml).toContain('name = "Renamed"');
  });

  it("owner only: a member gets 403, a non-member 404 (existence is not leaked)", async () => {
    expect((await member.patch(`/api/projects/${projectId}`, { name: "Nope" })).status).toBe(403);
    expect((await outsider.patch(`/api/projects/${projectId}`, { name: "Nope" })).status).toBe(404);

    // Neither refusal wrote anything.
    const list = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    expect(list.projects.find((p) => p.projectId === projectId)?.name).toBe("Before");
  });

  it("rejects a missing, blank or over-long name", async () => {
    expect((await owner.patch(`/api/projects/${projectId}`, {})).status).toBe(400);
    expect((await owner.patch(`/api/projects/${projectId}`, { name: "" })).status).toBe(400);
    // Whitespace only: trimmed to empty rather than stored as a blank display name.
    expect((await owner.patch(`/api/projects/${projectId}`, { name: "   " })).status).toBe(400);
    expect(
      (await owner.patch(`/api/projects/${projectId}`, { name: "x".repeat(101) })).status,
    ).toBe(400);

    const list = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    expect(list.projects.find((p) => p.projectId === projectId)?.name).toBe("Before");
  });

  it("stores the trimmed name", async () => {
    expect((await owner.patch(`/api/projects/${projectId}`, { name: "  Padded  " })).status).toBe(
      200,
    );
    const list = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    expect(list.projects.find((p) => p.projectId === projectId)?.name).toBe("Padded");
  });
});
