/**
 * Agent config route: the tools.call_descriptions toggle. GET omits the field while the
 * YAML has none (missing = enabled); PUT { callDescriptions: false } writes
 * tools.call_descriptions into system_config.yaml (preserving the rest of the file) and
 * the round-trip surfaces it; a non-boolean value is a 400; other config keys are
 * untouched by the toggle write.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { systemConfigPath } from "@prismshadow/penguin-core";
import type { AgentConfigResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("agent config: tools.call_descriptions", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let configPath: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_cd");
    owner = apiClient(t.app, a.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_cd-calldesc", name: "cd project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    configPath = `/api/projects/${projectId}/agents/default_agent/config`;
  });

  afterEach(async () => {
    await t.cleanup();
  });

  it("omits callDescriptions while unset, persists an explicit false, and round-trips", async () => {
    const initial = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    // A fresh agent has no tools.call_descriptions key (semantics: enabled).
    expect(initial.config.callDescriptions).toBeUndefined();
    // The default toolset ships the renamed shell tool and the file tools.
    const names = initial.config.toolsBuiltin.map((tool) => tool.name);
    expect(names).toContain("run_command");
    expect(names).toEqual(expect.arrayContaining(["read_file", "edit_file", "write_file"]));

    const putRes = await owner.put(configPath, { config: { callDescriptions: false } });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()) as AgentConfigResponse;
    expect(updated.config.callDescriptions).toBe(false);
    // Written into the YAML itself; the rest of the config is preserved.
    const yaml = await fs.readFile(systemConfigPath(t.root, projectId, "default_agent"), "utf8");
    expect(yaml).toContain("call_descriptions: false");
    expect(updated.config.systemPrompt).toBe(initial.config.systemPrompt);
    expect(updated.config.toolsBuiltin).toEqual(initial.config.toolsBuiltin);

    // Flip back on: the explicit true is stored and surfaced.
    const on = (await (
      await owner.put(configPath, { config: { callDescriptions: true } })
    ).json()) as AgentConfigResponse;
    expect(on.config.callDescriptions).toBe(true);
  });

  it("rejects a non-boolean callDescriptions with 400", async () => {
    const res = await owner.put(configPath, { config: { callDescriptions: "yes" } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(JSON.stringify(body)).toContain("callDescriptions");
  });
});
