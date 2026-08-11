/**
 * POST /api/projects/:projectId/agents/:agentId/config/kernel-update — smart-merges
 * system_config.yaml up to the current defaults generation: untouched old defaults advance,
 * customizations are kept and reported, the config is stamped. Also covers the kernel fields
 * of the config DTO and the agents-list kernelOutdated flag. Same member-level authorization
 * as /reset; a non-member gets 404 without a write.
 */
import fs from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { KERNEL_VERSION, defaultSystemConfig, systemConfigPath } from "@prismshadow/penguin-core";
import type {
  AgentConfigResponse,
  AgentKernelUpdateResponse,
  AgentsResponse,
  ProjectCreateResponse,
} from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("POST agent config kernel-update", () => {
  let t: TestApp;
  let alice: ReturnType<typeof apiClient>;
  let projectId: string;
  const configUrl = () => `/api/projects/${projectId}/agents/default_agent/config`;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "alice");
    alice = apiClient(t.app, a.cookie);
    const created = (await (
      await alice.post("/api/projects", { projectId: "alice-kernel", name: "Kernel project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  /**
   * Rewrites default_agent's config on disk into an aged shape with one user customization:
   * no kernel stamp, no vault/skills/schedules sections (a config from before those existed),
   * and a customized memory.prompt. The template stays the current default — the
   * old-template-advance path itself is core-tested against the frozen pre-toggles snapshot
   * (core/test/kernel-version.test.ts); here the endpoint semantics are what's under test.
   */
  async function agePersistedConfig(): Promise<void> {
    const configPath = systemConfigPath(t.root, projectId, "default_agent");
    const config = parseYaml(await fs.readFile(configPath, "utf8")) as Record<string, unknown>;
    delete config.kernel_version;
    delete config.vault;
    delete config.skills;
    delete config.schedules;
    config.memory = { ...(config.memory as object), prompt: "my memory prompt" };
    await fs.writeFile(configPath, stringifyYaml(config), "utf8");
  }

  it("reports a fresh agent as stamped and current (config DTO + agents list)", async () => {
    const got = (await (await alice.get(configUrl())).json()) as AgentConfigResponse;
    expect(got.config.kernelVersion).toBe(KERNEL_VERSION);
    expect(got.config.kernelLatest).toBe(KERNEL_VERSION);
    expect(got.config.kernelOutdated).toBe(false);
    const list = (await (
      await alice.get(`/api/projects/${projectId}/agents`)
    ).json()) as AgentsResponse;
    expect(list.agents.find((a) => a.agentId === "default_agent")?.kernelOutdated).toBe(false);
  });

  it("flags a pre-stamp config as outdated, then advances it while keeping the customization", async () => {
    await agePersistedConfig();

    const before = (await (await alice.get(configUrl())).json()) as AgentConfigResponse;
    expect(before.config.kernelVersion).toBeNull();
    expect(before.config.kernelOutdated).toBe(true);
    const listBefore = (await (
      await alice.get(`/api/projects/${projectId}/agents`)
    ).json()) as AgentsResponse;
    expect(listBefore.agents.find((a) => a.agentId === "default_agent")?.kernelOutdated).toBe(true);

    const res = await alice.post(`${configUrl()}/kernel-update`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AgentKernelUpdateResponse;
    expect(body.kernelVersion).toBe(KERNEL_VERSION);
    // The missing sections materialize; the untouched current-default template is not
    // reported (nothing to advance).
    expect(body.advanced).toContain("vault.prompt");
    expect(body.advanced).toContain("schedules.enabled");
    expect(body.advanced).not.toContain("system_prompt");
    expect(body.kept).toEqual(["memory.prompt"]);

    // Persisted: the sections advanced, the customization survived, the stamp is current.
    const after = (await (await alice.get(configUrl())).json()) as AgentConfigResponse;
    expect(after.config.systemPrompt).toBe(defaultSystemConfig().system_prompt);
    expect(after.config.vault.enabled).toBe(true);
    expect(after.config.memory.prompt).toBe("my memory prompt");
    expect(after.config.kernelVersion).toBe(KERNEL_VERSION);
    expect(after.config.kernelOutdated).toBe(false);
    const listAfter = (await (
      await alice.get(`/api/projects/${projectId}/agents`)
    ).json()) as AgentsResponse;
    expect(listAfter.agents.find((a) => a.agentId === "default_agent")?.kernelOutdated).toBe(false);
  });

  it("404 for a nonexistent agent (no initialization side effect)", async () => {
    const res = await alice.post(`/api/projects/${projectId}/agents/ghost/config/kernel-update`);
    expect(res.status).toBe(404);
  });

  it("404 for a non-member; the config is not modified", async () => {
    await agePersistedConfig();
    const before = (await (await alice.get(configUrl())).json()) as AgentConfigResponse;
    const m = await provisionUser(t.app, "mallory");
    const mallory = apiClient(t.app, m.cookie);
    const res = await mallory.post(`${configUrl()}/kernel-update`);
    expect(res.status).toBe(404);
    const after = (await (await alice.get(configUrl())).json()) as AgentConfigResponse;
    expect(after.systemConfigYaml).toBe(before.systemConfigYaml);
  });
});
