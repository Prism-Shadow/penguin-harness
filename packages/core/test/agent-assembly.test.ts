/**
 * AgentAssembly: what the hosting process adds to every Session — prompt sections
 * appended under their own headings.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createAgent } from "../src/agent.js";

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
});
