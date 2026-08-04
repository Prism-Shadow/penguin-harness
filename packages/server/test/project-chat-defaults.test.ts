/**
 * GET|PUT /api/projects/:p/chat-defaults — per-Project new-chat defaults (the
 * `[default_chat]` block of .project_config.toml) — and PUT /api/projects/:p/models/default,
 * the narrow default-model switch project settings uses.
 *
 * Pins the contract's load-bearing corners: who may read (any member) and write (owner
 * only, with a non-member unable to tell the Project exists), that PUT is a declarative
 * whole-block replace (an omitted key clears it; an empty body removes the block), that a
 * defaults write is a read-modify-write of the same toml — models, credentials and the
 * display name must survive — and that agentId / enum values are validated (the model
 * default stays the SAME top-level `default_model` the models page maintains, so the
 * narrow route must reject a pair outside the models table exactly like the whole-table
 * PUT does).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import type {
  ChatDefaultsDto,
  DefaultModelResponse,
  ErrorBody,
  ModelsResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("project chat defaults", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let url: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    // createProject provisions the built-in default_agent, so a valid agentId exists.
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-shared", name: "Shared" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    url = `/api/projects/${projectId}/chat-defaults`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("any member reads; an absent block is an empty object; a non-member gets 404", async () => {
    const res = await member.get(url);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});
    expect((await outsider.get(url)).status).toBe(404);
  });

  it("owner PUT round-trips all four fields; the toml carries [default_chat]", async () => {
    const body: ChatDefaultsDto = {
      agentId: "default_agent",
      workspace: "/tmp/anywhere", // not validated as an existing directory (a prefill only)
      approvalMode: "always-ask",
      thinkingLevel: "high",
    };
    const put = await owner.put(url, body);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual(body);
    expect(await (await member.get(url)).json()).toEqual(body);

    const toml = await fs.readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain("[default_chat]");
    expect(toml).toContain('agent_id = "default_agent"');
    expect(toml).toContain('thinking_level = "high"');
  });

  it("PUT is whole-block replace: an omitted key clears it; an empty body removes the block", async () => {
    expect(
      (await owner.put(url, { agentId: "default_agent", approvalMode: "read-only" })).status,
    ).toBe(200);
    // Replace with a different subset: the previous keys must be gone.
    const second = await owner.put(url, { thinkingLevel: "low" });
    expect(await second.json()).toEqual({ thinkingLevel: "low" });
    expect(await (await owner.get(url)).json()).toEqual({ thinkingLevel: "low" });
    // Empty body: the block disappears from the toml entirely.
    expect(await (await owner.put(url, {})).json()).toEqual({});
    const toml = await fs.readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).not.toContain("default_chat");
  });

  it("owner only: a member PUT gets 403, a non-member 404 (existence is not leaked)", async () => {
    expect((await member.put(url, { thinkingLevel: "low" })).status).toBe(403);
    expect((await outsider.put(url, { thinkingLevel: "low" })).status).toBe(404);
    expect(await (await owner.get(url)).json()).toEqual({});
  });

  it("agentId must reference an existing Agent of the Project (400 unknown_agent)", async () => {
    const res = await owner.put(url, { agentId: "ghost_agent" });
    expect(res.status).toBe(400);
    expect(((await res.json()) as ErrorBody).error.code).toBe("unknown_agent");
    // An id that is not even shaped like one gets the same 400 before any path is built.
    expect((await owner.put(url, { agentId: "../escape" })).status).toBe(400);
    expect(await (await owner.get(url)).json()).toEqual({});
  });

  it("rejects invalid enum values with 400 — including thinkingLevel 'none'", async () => {
    expect((await owner.put(url, { approvalMode: "yolo" })).status).toBe(400);
    // "none" is a valid per-turn wire value but never a project default.
    expect((await owner.put(url, { thinkingLevel: "none" })).status).toBe(400);
    expect((await owner.put(url, { thinkingLevel: 3 })).status).toBe(400);
    expect(await (await owner.get(url)).json()).toEqual({});
  });

  it("keeps models, credentials and the name — the write is read-modify-write", async () => {
    expect(
      (
        await owner.put(`/api/projects/${projectId}/models`, {
          defaultModel: { provider: "custom", modelId: "m-1" },
          models: [{ provider: "custom", modelId: "m-1", apiKey: "sk-super-secret-key-123456" }],
        })
      ).status,
    ).toBe(200);

    expect((await owner.put(url, { approvalMode: "deny-all" })).status).toBe(200);

    const models = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    expect(models.defaultModel).toEqual({ provider: "custom", modelId: "m-1" });
    expect(models.models).toHaveLength(1);
    // The key is masked on read, so assert on the file: a replacing write would drop it.
    const toml = await fs.readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain("sk-super-secret-key-123456");
    expect(toml).toContain('name = "Shared"');
    expect(toml).toContain('approval_mode = "deny-all"');
  });

  it("a config carrying [default_chat] still parses back whole (the table never swallows scalars)", async () => {
    // Defaults written BEFORE a name rewrite: the later RMW re-renders the whole file, and
    // the [default_chat] table must end up below the re-appended scalar keys.
    expect((await owner.put(url, { workspace: "/srv/data" })).status).toBe(200);
    expect((await owner.patch(`/api/projects/${projectId}`, { name: "Renamed" })).status).toBe(200);
    expect(await (await owner.get(url)).json()).toEqual({ workspace: "/srv/data" });
    const toml = await fs.readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain('name = "Renamed"');
  });
});

describe("models default (narrow default-model switch)", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let url: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-models", name: "Models" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    url = `/api/projects/${projectId}/models/default`;
    // Two configured models, m-1 as the default, a credential to preserve.
    expect(
      (
        await owner.put(`/api/projects/${projectId}/models`, {
          defaultModel: { provider: "custom", modelId: "m-1" },
          models: [
            { provider: "custom", modelId: "m-1", apiKey: "sk-super-secret-key-123456" },
            { provider: "custom", modelId: "m-2" },
          ],
        })
      ).status,
    ).toBe(200);
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("owner flips the default; the response mirrors GET models' defaultModel; credentials survive", async () => {
    const res = await owner.put(url, { provider: "custom", modelId: "m-2" });
    expect(res.status).toBe(200);
    expect((await res.json()) as DefaultModelResponse).toEqual({
      defaultModel: { provider: "custom", modelId: "m-2" },
    });
    const models = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    expect(models.defaultModel).toEqual({ provider: "custom", modelId: "m-2" });
    expect(models.models.find((m) => m.modelId === "m-2")?.isDefault).toBe(true);
    // RMW: the other entry's inline credential is untouched.
    const toml = await fs.readFile(path.join(t.root, projectId, ".project_config.toml"), "utf8");
    expect(toml).toContain("sk-super-secret-key-123456");
  });

  it("400 when the pair is not in the models table (a mismatched provider included)", async () => {
    expect((await owner.put(url, { provider: "custom", modelId: "nope" })).status).toBe(400);
    // The bare id exists but under another provider: exact pair matching, no fuzzy fallback.
    expect((await owner.put(url, { provider: "openai", modelId: "m-2" })).status).toBe(400);
    // Half a reference is a shape error, not a lookup.
    expect((await owner.put(url, { provider: "custom" })).status).toBe(400);
    const models = (await (
      await owner.get(`/api/projects/${projectId}/models`)
    ).json()) as ModelsResponse;
    expect(models.defaultModel).toEqual({ provider: "custom", modelId: "m-1" });
  });

  it("owner only: a member gets 403, a non-member 404", async () => {
    expect((await member.put(url, { provider: "custom", modelId: "m-2" })).status).toBe(403);
    expect((await outsider.put(url, { provider: "custom", modelId: "m-2" })).status).toBe(404);
  });
});
