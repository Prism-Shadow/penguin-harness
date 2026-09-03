/**
 * AgentAssembly: what the hosting process adds to every Session — prompt sections under
 * their own headings, and tool factories consulted before the built-in registry.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.js";
import { Environment } from "../src/environment/index.js";
import type { BuiltinTool } from "../src/environment/tools/types.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});

describe("AgentAssembly", () => {
  it("appends prompt sections under their headings, after the Agent's own prompt", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-assembly-"));
    roots.push(root);
    const agent = await createAgent({
      root,
      assembly: { promptSections: () => [{ title: "Host", text: "You run inside a test." }] },
    });
    const session = await agent.createSession({
      modelId: agent.projectConfig.default_model!.model_id,
      provider: agent.projectConfig.default_model!.provider,
      apiKey: "test-key",
    });
    const prompt = (session.metaMessage.payload as { system_prompt: string }).system_prompt;
    expect(prompt.endsWith("# Host\nYou run inside a test.")).toBe(true);
    expect(prompt.startsWith(agent.state.systemConfig.system_prompt.slice(0, 20))).toBe(true);
    session.dispose();
  });

  it("assembles a config-listed tool from the host's factory before the built-in registry", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-assembly-"));
    roots.push(root);
    const hostTool: BuiltinTool = {
      name: "host_echo",
      definition: { name: "host_echo", description: "echo", parameters: {} },
      async *execute() {
        return {};
      },
    };
    const env = new Environment({
      workspaceDir: root,
      toolConfig: {
        customTools: [
          { name: "host_echo", description: "echo (config)", parameters: {} },
          { name: "not_provided", description: "skipped", parameters: {} },
        ],
        mcpServers: [],
      },
      toolFactories: { host_echo: () => hostTool },
    });
    const names = (await env.listTools()).map((t) => t.name);
    expect(names).toEqual(["host_echo"]);
    env.dispose();
  });
});
