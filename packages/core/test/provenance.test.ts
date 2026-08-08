import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  buildAgentProvenance,
  installSkill,
  loadOrInitAgentState,
  removeSkill,
  systemConfigPath,
  type AgentState,
} from "../src/state/index.js";

let tmpRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-prov-"));
  process.env.PENGUIN_HOME = tmpRoot;
});

afterEach(async () => {
  if (prevHome === undefined) {
    delete process.env.PENGUIN_HOME;
  } else {
    process.env.PENGUIN_HOME = prevHome;
  }
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

/** Init a fresh default_agent (gets the example skills + benchmark) and return its state. */
async function initState(): Promise<AgentState> {
  return loadOrInitAgentState({
    root: tmpRoot,
    projectId: DEFAULT_PROJECT_ID,
    agentId: DEFAULT_AGENT_ID,
  });
}

/** Rewrite system_config.yaml's system_prompt in place, then reload the state. */
async function editSystemPrompt(newPrompt: string): Promise<AgentState> {
  const cfgPath = systemConfigPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
  const cfg = parseYaml(await fs.readFile(cfgPath, "utf8")) as Record<string, unknown>;
  cfg.system_prompt = newPrompt;
  await fs.writeFile(cfgPath, stringifyYaml(cfg), "utf8");
  return initState();
}

describe("buildAgentProvenance", () => {
  it("is deterministic for the same Agent State", async () => {
    const state = await initState();
    const a = await buildAgentProvenance(state);
    const b = await buildAgentProvenance(state);
    expect(a.agent_sha256).toBe(b.agent_sha256);
    expect(a.system_prompt_sha256).toBe(b.system_prompt_sha256);
    expect(a.skills_sha256).toBe(b.skills_sha256);
    expect(a.tools_sha256).toBe(b.tools_sha256);
    expect(a.provenance_version).toBe(1);
  });

  it("changes agent_sha256 and system_prompt_sha256 (only) when the system prompt is edited", async () => {
    const before = await buildAgentProvenance(await initState());
    const after = await buildAgentProvenance(
      await editSystemPrompt("# Role\nYou are a totally different agent.\n"),
    );
    expect(after.agent_sha256).not.toBe(before.agent_sha256);
    expect(after.system_prompt_sha256).not.toBe(before.system_prompt_sha256);
    // Localization: skills and tools didn't change, so their sub-hashes stay put.
    expect(after.skills_sha256).toBe(before.skills_sha256);
    expect(after.tools_sha256).toBe(before.tools_sha256);
  });

  it("changes skills_sha256 and agent_sha256 when a skill is added or removed", async () => {
    const state = await initState();
    const before = await buildAgentProvenance(state);

    await installSkill(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, {
      name: "extra-skill",
      content:
        "---\nname: extra-skill\ndescription: test\nversion: 1\nupdated: 2026-01-01T00:00:00Z\n---\n\n# Extra\n",
    });
    const added = await buildAgentProvenance(state);
    expect(added.skills_sha256).not.toBe(before.skills_sha256);
    expect(added.agent_sha256).not.toBe(before.agent_sha256);
    expect(added.skills.some((s) => s.name === "extra-skill")).toBe(true);
    expect(added.system_prompt_sha256).toBe(before.system_prompt_sha256);

    await removeSkill(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID, "extra-skill");
    const removed = await buildAgentProvenance(state);
    expect(removed.skills_sha256).toBe(before.skills_sha256);
    expect(removed.agent_sha256).toBe(before.agent_sha256);
  });

  it("folds the model reference into agent_sha256 and echoes it", async () => {
    const state = await initState();
    const plain = await buildAgentProvenance(state);
    const withModel = await buildAgentProvenance(state, {
      model: { provider: "deepseek", model_id: "deepseek-v4-pro" },
    });
    expect(withModel.model).toEqual({ provider: "deepseek", model_id: "deepseek-v4-pro" });
    expect(withModel.agent_sha256).not.toBe(plain.agent_sha256);
    // Same model reference → same fingerprint again.
    const withModel2 = await buildAgentProvenance(state, {
      model: { provider: "deepseek", model_id: "deepseek-v4-pro" },
    });
    expect(withModel2.agent_sha256).toBe(withModel.agent_sha256);
  });
});
