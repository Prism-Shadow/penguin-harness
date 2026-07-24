/**
 * POST /api/projects/:projectId/agents/:agentId/config/reset — overwrites
 * system_config.yaml with the current code defaults, keeping only the identity fields
 * (name / description / version); the config-side analogue of a skill update. Same
 * member-level authorization as PUT config; a non-member gets 404 without a write.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultSystemConfig } from "@prismshadow/penguin-core";
import type { AgentConfigResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("POST agent config reset", () => {
  let t: TestApp;
  let alice: ReturnType<typeof apiClient>;
  let projectId: string;
  const configUrl = () => `/api/projects/${projectId}/agents/default_agent/config`;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "alice");
    alice = apiClient(t.app, a.cookie);
    // Project ids are username-prefixed (`alice-…`), same as the other route tests.
    const created = (await (
      await alice.post("/api/projects", { projectId: "alice-reset", name: "Reset project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("restores the defaults while preserving name / description / version", async () => {
    // Customize everything the reset is supposed to overwrite, plus the kept fields.
    const put = await alice.put(configUrl(), {
      config: {
        name: "Custom Name",
        description: "Custom description",
        systemPrompt: "CUSTOM PROMPT",
        maxTurns: 3,
        model: { maxTokens: 1234 },
        compaction: { mode: "discard" },
        toolsBuiltin: [],
        mcpServers: [{ name: "custom-mcp", config: {} }],
      },
    });
    expect(put.status).toBe(200);

    const res = await alice.post(`${configUrl()}/reset`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AgentConfigResponse;
    const defaults = defaultSystemConfig();

    // Identity fields survive.
    expect(body.config.name).toBe("Custom Name");
    expect(body.config.description).toBe("Custom description");
    expect(body.config.version).toBe(1);
    // Everything else is back to the current defaults.
    expect(body.config.systemPrompt).toBe(defaults.system_prompt);
    expect(body.config.systemPrompt).toContain("Agents Dir: {{AGENTS_DIR}}");
    expect(body.config.maxTurns).toBe(defaults.max_turns);
    expect(body.config.model?.maxTokens).toBe(defaults.model?.max_tokens);
    expect(body.config.compaction?.mode).toBe("summarize");
    expect(body.config.toolsBuiltin.map((tool) => tool.name)).toEqual(
      (defaults.tools?.builtin ?? []).map((tool) => tool.name),
    );
    expect(body.config.mcpServers).toEqual([]);

    // A later GET sees the same reset state (it was persisted, not just echoed).
    const got = (await (await alice.get(configUrl())).json()) as AgentConfigResponse;
    expect(got.config.systemPrompt).toBe(defaults.system_prompt);
    expect(got.config.name).toBe("Custom Name");
  });

  it("404 for a nonexistent agent (no initialization side effect)", async () => {
    const res = await alice.post(`/api/projects/${projectId}/agents/ghost/config/reset`);
    expect(res.status).toBe(404);
  });

  it("404 for a non-member; the config is not modified", async () => {
    const before = (await (await alice.get(configUrl())).json()) as AgentConfigResponse;
    const m = await provisionUser(t.app, "mallory");
    const mallory = apiClient(t.app, m.cookie);
    const res = await mallory.post(`${configUrl()}/reset`);
    expect(res.status).toBe(404);
    const after = (await (await alice.get(configUrl())).json()) as AgentConfigResponse;
    expect(after.systemConfigYaml).toBe(before.systemConfigYaml);
  });
});
