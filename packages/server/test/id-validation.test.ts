/**
 * Integration tests for path-parameter id validation (FD-4, path
 * traversal prevention): Hono decodes URL-encoded `%2F` into a single path
 * parameter — a traversal-style agentId (`../<victim>/...`), if passed through
 * to path construction unchanged, would let an attacker read/write another
 * user's Agent config and Trace across Projects.
 * Every route that takes :agentId (config / traces / sessions / trace detail)
 * must return 404.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("id-validation", () => {
  let t: TestApp;
  let attacker: ReturnType<typeof apiClient>;
  let attackerProject: string;
  let victimProject: string;

  /** Traversal-style agentId pointing at the victim Project's default_agent (URL-encoded so it all lands in :agentId). */
  const traversal = () => `..%2F${victimProject}%2Fdefault_agent`;
  const agentBase = () => `/api/projects/${attackerProject}/agents`;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "attacker");
    const v = await provisionUser(t.app, "victim");
    attacker = apiClient(t.app, a.cookie);
    const victim = apiClient(t.app, v.cookie);
    const created = (await (
      await attacker.post("/api/projects", { projectId: "attacker-proj", name: "攻击者项目" })
    ).json()) as ProjectCreateResponse;
    attackerProject = created.project.projectId;
    const victimCreated = (await (
      await victim.post("/api/projects", { projectId: "victim-proj", name: "受害者项目" })
    ).json()) as ProjectCreateResponse;
    victimProject = victimCreated.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("GET config：穿越型 agentId → 404，不泄露他人 system_config.yaml", async () => {
    // The victim Agent's config does exist (readable by the victim via the legitimate path).
    const victimConfigPath = path.join(
      t.root,
      victimProject,
      "agents",
      "default_agent",
      "agent_state",
      "system_config.yaml",
    );
    await expect(fs.access(victimConfigPath)).resolves.toBeUndefined();

    const res = await attacker.get(`${agentBase()}/${traversal()}/config`);
    expect(res.status).toBe(404);
    // Legitimate access to one's own Agent is unaffected.
    const own = await attacker.get(`${agentBase()}/default_agent/config`);
    expect(own.status).toBe(200);
  });

  it("PUT config：穿越型 agentId → 404，受害文件未被覆写", async () => {
    const victimConfigPath = path.join(
      t.root,
      victimProject,
      "agents",
      "default_agent",
      "agent_state",
      "system_config.yaml",
    );
    const before = await fs.readFile(victimConfigPath, "utf8");
    const res = await attacker.put(`${agentBase()}/${traversal()}/config`, {
      config: { systemPrompt: "pwned" },
    });
    expect(res.status).toBe(404);
    expect(await fs.readFile(victimConfigPath, "utf8")).toBe(before);
  });

  it("GET traces / GET|POST sessions：穿越型 agentId → 404", async () => {
    expect((await attacker.get(`${agentBase()}/${traversal()}/traces`)).status).toBe(404);
    expect((await attacker.get(`${agentBase()}/${traversal()}/sessions`)).status).toBe(404);
    expect((await attacker.post(`${agentBase()}/${traversal()}/sessions`, {})).status).toBe(404);
  });

  it("Trace 明细端点：穿越型 sessionId / agentId → 404", async () => {
    expect((await attacker.get(`${agentBase()}/default_agent/traces/..%2Fx/1`)).status).toBe(404);
    expect(
      (await attacker.get(`${agentBase()}/default_agent/traces/..%2Fx/1/analysis`)).status,
    ).toBe(404);
    expect((await attacker.get(`${agentBase()}/${traversal()}/traces/s/1`)).status).toBe(404);
  });

  it("穿越型 / 含非法字符的 projectId → 404（防御性校验）", async () => {
    expect((await attacker.get(`/api/projects/..%2Fetc/agents`)).status).toBe(404);
    expect((await attacker.get(`/api/projects/..%2Fetc/models`)).status).toBe(404);
    expect((await attacker.get(`/api/projects/..%2Fetc/usage`)).status).toBe(404);
    expect((await attacker.get(`/api/projects/..%2Fetc/members`)).status).toBe(404);
    expect((await attacker.delete(`/api/projects/..%2F${victimProject}`)).status).toBe(404);
  });
});
