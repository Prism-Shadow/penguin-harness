/**
 * The Agent config route's per-tool `call_description` field on toolsBuiltin rows.
 *
 * - The defaults carry `call_description: true` (and the `description` parameter) on the four
 *   command and subagent tools; a PUT of `false` round-trips into system_config.yaml, keeping
 *   the rest of the file.
 * - A non-boolean value is a 400.
 * - Removing a tool through config prevents a freshly assembled Environment from exposing or
 *   executing it; deleting the last tool persists an empty toolset instead of restoring defaults.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import {
  systemConfigPath,
  buildToolConfig,
  loadAgentState,
  Environment,
  toolCall,
} from "@prismshadow/penguin-core";
import type { ToolDefinitionConfig } from "@prismshadow/penguin-core";
import type { AgentConfigResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

describe("agent config: per-tool call_description", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let projectId: string;
  let configPath: string;

  beforeAll(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_cd");
    owner = apiClient(t.app, a.cookie);
  });
  afterAll(async () => {
    await t.cleanup();
  });

  // Every case works in a Project of its own.
  let projects = 0;
  beforeEach(async () => {
    projects += 1;
    const created = (await (
      await owner.post("/api/projects", {
        projectId: `owner_cd-calldesc_${projects}`,
        name: "cd project",
      })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    configPath = `/api/projects/${projectId}/agents/default_agent/config`;
  });

  it("defaults carry call_description: true and the description property; PUT false round-trips", async () => {
    const initial = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    const names = initial.config.toolsBuiltin.map((tool) => tool.name);
    // File tools lead the default toolset; the renamed shell tool follows.
    expect(names.slice(0, 4)).toEqual(["read_file", "edit_file", "write_file", "exec_command"]);
    const propsOf = (tool: ToolDefinitionConfig): Record<string, unknown> =>
      (tool.parameters as { properties: Record<string, unknown> }).properties;
    for (const name of ["exec_command", "input_command", "run_subagent", "input_subagent"]) {
      const tool = initial.config.toolsBuiltin.find((row) => row.name === name)!;
      expect(tool.call_description).toBe(true);
      expect(propsOf(tool)["description"]).toBeDefined();
    }
    for (const name of ["read_file", "edit_file", "write_file"]) {
      const tool = initial.config.toolsBuiltin.find((row) => row.name === name)!;
      expect(tool.call_description).toBeUndefined();
      expect(propsOf(tool)["description"]).toBeUndefined();
    }

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

  it("removes tools from fresh contexts, including when the last tool is deleted", async () => {
    const initial = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    const remaining = initial.config.toolsBuiltin.filter((tool) => tool.name !== "write_file");
    expect((await owner.put(configPath, { config: { toolsBuiltin: remaining } })).status).toBe(200);
    const state = await loadAgentState({ root: t.root, projectId, agentId: "default_agent" });
    const environment = new Environment({
      workspaceDir: t.root,
      toolConfig: buildToolConfig(state),
    });
    try {
      expect((await environment.listTools()).map((tool) => tool.name)).not.toContain("write_file");
      const call = toolCall({
        name: "write_file",
        arguments: JSON.stringify({ path: "deleted-tool.txt", content: "unwanted" }),
        toolCallId: "removed",
      });
      const outputs = [];
      for await (const message of environment.executeTool({ toolCall: call }))
        outputs.push(message);
      expect(JSON.stringify(outputs)).toContain("Unknown tool: write_file");
      await expect(fs.access(`${t.root}/deleted-tool.txt`)).rejects.toThrow();
    } finally {
      environment.dispose();
    }
    expect((await owner.put(configPath, { config: { toolsBuiltin: [] } })).status).toBe(200);
    const cleared = (await (await owner.get(configPath)).json()) as AgentConfigResponse;
    expect(cleared.config.toolsBuiltin).toEqual([]);
    const empty = new Environment({
      workspaceDir: t.root,
      toolConfig: buildToolConfig(
        await loadAgentState({ root: t.root, projectId, agentId: "default_agent" }),
      ),
    });
    try {
      expect(await empty.listTools()).toEqual([]);
    } finally {
      empty.dispose();
    }
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
