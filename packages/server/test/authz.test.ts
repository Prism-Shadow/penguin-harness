/**
 * Authorization rules integration tests: three perspectives — owner / member / no
 * access; permission boundaries for model config and member management; access control
 * for Session-level routes via index lookup; default_project deletion protection.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  MembersResponse,
  ModelsResponse,
  ProjectCreateResponse,
  ProjectsResponse,
  SessionCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("authz", () => {
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
      await owner.post("/api/projects", { projectId: "owner_a-shared", name: "Shared project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    const add = await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" });
    expect(add.status).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("non-member access returns 404 (does not leak existence)", async () => {
    expect((await outsider.get(`/api/projects/${projectId}/models`)).status).toBe(404);
    expect((await outsider.get(`/api/projects/${projectId}/agents`)).status).toBe(404);
    expect((await outsider.get(`/api/projects/${projectId}/members`)).status).toBe(404);
    expect((await outsider.get(`/api/projects/${projectId}/usage`)).status).toBe(404);
  });

  it("member can read models (masked) but not write; owner can write", async () => {
    const put = await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "custom", modelId: "m-1" },
      models: [{ provider: "custom", modelId: "m-1", apiKey: "sk-super-secret-key-123456" }],
    });
    expect(put.status).toBe(200);

    const res = await member.get(`/api/projects/${projectId}/models`);
    expect(res.status).toBe(200);
    const models = (await res.json()) as ModelsResponse;
    expect(models.defaultModel).toEqual({ provider: "custom", modelId: "m-1" });
    const cred = models.models[0]!.credential!;
    expect(cred.apiKeyMasked).toBe("sk-s…3456");
    expect(JSON.stringify(models)).not.toContain("sk-super-secret-key-123456");

    const denied = await member.put(`/api/projects/${projectId}/models`, {
      models: [{ provider: "custom", modelId: "m-2" }],
    });
    expect(denied.status).toBe(403);
  });

  it("member management owner-only: duplicate and self-grant 409; unknown user 404", async () => {
    const list = (await (
      await member.get(`/api/projects/${projectId}/members`)
    ).json()) as MembersResponse;
    expect(list.members.map((m) => `${m.userId}:${m.role}`)).toEqual([
      "owner_a:owner",
      "member_b:member",
    ]);

    expect(
      (await member.post(`/api/projects/${projectId}/members`, { userId: "outsider_c" })).status,
    ).toBe(403);
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(409);
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "owner_a" })).status,
    ).toBe(409);
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "ghost" })).status,
    ).toBe(404);

    // After removing authorization, the member loses access.
    expect((await owner.delete(`/api/projects/${projectId}/members/member_b`)).status).toBe(204);
    expect((await member.get(`/api/projects/${projectId}/models`)).status).toBe(404);
  });

  it("Session-level routes authorize via index lookup: member can see, outsider 404", async () => {
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "anthropic", modelId: "claude-sonnet-4-6" },
      models: [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }],
    });
    const created = await owner.post(
      `/api/projects/${projectId}/agents/default_agent/sessions`,
      {},
    );
    expect(created.status).toBe(201);
    const { session } = (await created.json()) as SessionCreateResponse;

    expect((await owner.get(`/api/sessions/${session.sessionId}`)).status).toBe(200);
    expect((await member.get(`/api/sessions/${session.sessionId}`)).status).toBe(200);
    expect((await outsider.get(`/api/sessions/${session.sessionId}`)).status).toBe(404);
    expect((await owner.get("/api/sessions/session-unknown")).status).toBe(404);
  });

  it("deleting Projects: owner-only; default_project and the last accessible refuse", async () => {
    expect((await member.delete(`/api/projects/${projectId}`)).status).toBe(403);
    expect((await outsider.delete(`/api/projects/${projectId}`)).status).toBe(404);
    // default_project is managed by admin: non-owners always get 404, and the owner (admin) is refused with 409.
    expect((await owner.delete("/api/projects/default_project")).status).toBe(404);
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    expect((await admin.delete("/api/projects/default_project")).status).toBe(409);

    // outsider-c only has the initial Project created at account setup: deleting it would
    // leave the account with no usable Project (stuck on the skeleton screen on the Web
    // side) -> refused with 409.
    const cProjects = (await (await outsider.get("/api/projects")).json()) as ProjectsResponse;
    expect(cProjects.projects).toHaveLength(1);
    expect(
      (await outsider.delete(`/api/projects/${cProjects.projects[0]!.projectId}`)).status,
    ).toBe(409);

    expect((await owner.delete(`/api/projects/${projectId}`)).status).toBe(204);
    expect((await owner.get(`/api/projects/${projectId}/models`)).status).toBe(404);
  });

  it("PUT models is a full replace: omitted apiKey kept, clearApiKey clears", async () => {
    await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "custom", modelId: "m-1" },
      models: [
        {
          provider: "custom",
          modelId: "m-1",
          contextWindow: 200000,
          pricing: { cacheRead: 0.3, cacheWrite: 3.75, output: 15 },
          apiKey: "sk-original-key-000111",
          baseUrl: "https://example.com/v1",
        },
        { provider: "custom", modelId: "m-2" },
      ],
    });
    // Omitting apiKey: preserves the original credential and created_at.
    const second = (await (
      await owner.put(`/api/projects/${projectId}/models`, {
        defaultModel: { provider: "custom", modelId: "m-1" },
        models: [{ provider: "custom", modelId: "m-1", contextWindow: 100000 }],
      })
    ).json()) as ModelsResponse;
    expect(second.models).toHaveLength(1); // m-2 was removed by the full-table replace
    expect(second.models[0]!.credential?.apiKeyMasked).toBe("sk-o…0111");
    expect(second.models[0]!.credential?.baseUrl).toBe("https://example.com/v1");
    expect(second.models[0]!.credential?.createdAt).toBeTruthy();
    expect(second.models[0]!.contextWindow).toBe(100000);
    expect(second.models[0]!.pricing).toBeUndefined(); // Fields not resubmitted are removed by the replace

    // clearApiKey + baseUrl null clears the value.
    const third = (await (
      await owner.put(`/api/projects/${projectId}/models`, {
        defaultModel: { provider: "custom", modelId: "m-1" },
        models: [{ provider: "custom", modelId: "m-1", clearApiKey: true, baseUrl: null }],
      })
    ).json()) as ModelsResponse;
    expect(third.models[0]!.credential).toBeUndefined();

    // defaultModel not present in models -> 400.
    const bad = await owner.put(`/api/projects/${projectId}/models`, {
      defaultModel: { provider: "custom", modelId: "ghost" },
      models: [{ provider: "custom", modelId: "m-1" }],
    });
    expect(bad.status).toBe(400);
  });
});
