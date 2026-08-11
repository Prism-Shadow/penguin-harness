/**
 * Agent config route: the per-tool `call_description` field on toolsBuiltin rows. The
 * default config writes `call_description: true` (plus the `description` property in
 * parameters) on search plus the four command/subagent tools; PUT round-trips a flipped `false` into
 * system_config.yaml (preserving the rest of the file); a non-boolean value is a 400.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { systemConfigPath } from "@prismshadow/penguin-core";
import type { ToolDefinitionConfig } from "@prismshadow/penguin-core";
import type { AgentConfigResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("agent config: per-tool call_description", () => {
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

  it("defaults carry call_description: true and the description property; PUT false round-trips", async () => {
    const initial = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    const names = initial.config.toolsBuiltin.map((tool) => tool.name);
    // File tools lead the default toolset; native web search follows before the shell tool.
    expect(names.slice(0, 5)).toEqual([
      "read_file",
      "edit_file",
      "write_file",
      "web_search",
      "exec_command",
    ]);
    const propsOf = (tool: ToolDefinitionConfig): Record<string, unknown> =>
      (tool.parameters as { properties: Record<string, unknown> }).properties;
    for (const name of [
      "web_search",
      "exec_command",
      "input_command",
      "run_subagent",
      "input_subagent",
    ]) {
      const tool = initial.config.toolsBuiltin.find((row) => row.name === name)!;
      expect(tool.call_description).toBe(true);
      expect(propsOf(tool)["description"]).toBeDefined();
    }
    for (const name of ["read_file", "edit_file", "write_file"]) {
      const tool = initial.config.toolsBuiltin.find((row) => row.name === name)!;
      expect(tool.call_description).toBeUndefined();
      expect(propsOf(tool)["description"]).toBeUndefined();
    }
    expect(initial.config.toolsBuiltin.find((row) => row.name === "web_search")!.permission).toBe(
      "r",
    );

    // Flip exec_command's toggle off via the whole-table PUT.
    const tools = initial.config.toolsBuiltin.map((row) =>
      row.name === "exec_command" ? { ...row, call_description: false } : row,
    );
    const putRes = await owner.put(configPath, { config: { toolsBuiltin: tools } });
    expect(putRes.status).toBe(200);
    const updated = (await putRes.json()) as AgentConfigResponse;
    expect(
      updated.config.toolsBuiltin.find((row) => row.name === "exec_command")!.call_description,
    ).toBe(false);
    // Written into the YAML itself; the rest of the config is preserved.
    const yaml = await fs.readFile(systemConfigPath(t.root, projectId, "default_agent"), "utf8");
    expect(yaml).toContain("call_description: false");
    expect(updated.config.systemPrompt).toBe(initial.config.systemPrompt);
    // The property stays declared in the stored parameters (filtering happens at assembly, not in the config).
    expect(
      propsOf(updated.config.toolsBuiltin.find((row) => row.name === "exec_command")!)[
        "description"
      ],
    ).toBeDefined();
  });

  it("rejects a non-boolean call_description with 400", async () => {
    const initial = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    const tools = initial.config.toolsBuiltin.map((row) =>
      row.name === "exec_command" ? { ...row, call_description: "yes" } : row,
    );
    const res = await owner.put(configPath, { config: { toolsBuiltin: tools } });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(JSON.stringify(body)).toContain("call_description");
  });
});
