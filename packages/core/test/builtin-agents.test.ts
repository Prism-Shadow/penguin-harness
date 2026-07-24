/**
 * Built-in agent provisioning and skill library install policy: the sole built-in agent
 * default_agent comes pre-installed with every skill in the library, an ordinary newly created
 * agent starts with zero skills, and the default AGENTS.md is an empty file; provisionProjectAgents
 * is idempotent and never overwrites existing config.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { librarySkill, loadLibrarySkills } from "@prismshadow/penguin-skills";
import {
  agentsMdPath,
  assembleSystemPrompt,
  BUILTIN_AGENT_IDS,
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  listInstalledSkills,
  loadOrInitAgentState,
  provisionProjectAgents,
  skillsDir,
} from "../src/state/index.js";

let tmpRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-builtin-"));
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

const skillMdPath = (agentId: string, skillName: string): string =>
  path.join(skillsDir(tmpRoot, DEFAULT_PROJECT_ID, agentId), skillName, "SKILL.md");

describe("Skill installation policy", () => {
  it("a plain new Agent preinstalls no Skills and AGENTS.md is an empty file (guidance lives in the template's Suggested workflows)", async () => {
    const state = await loadOrInitAgentState({ agentId: "some_agent" });
    expect(await listInstalledSkills(tmpRoot, DEFAULT_PROJECT_ID, "some_agent")).toEqual([]);

    // The default AGENTS.md is empty: it carries no preset guidance (delegation and task
    // conventions live in the default template's Suggested workflows section, and skill
    // metadata is injected via {{SKILL_METADATA}}).
    expect(state.agentsMd).toBe("");
    const onDisk = await fs.readFile(
      agentsMdPath(tmpRoot, DEFAULT_PROJECT_ID, "some_agent"),
      "utf8",
    );
    expect(onDisk).toBe("");
  });

  it("a default_agent created directly without a preset (e.g. first CLI run) likewise preinstalls every Skill in the library", async () => {
    await loadOrInitAgentState({ agentId: DEFAULT_AGENT_ID });
    const names = (await listInstalledSkills(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID)).map(
      (s) => s.name,
    );
    expect(names).toEqual(loadLibrarySkills().map((s) => s.name));
  });
});

describe("provisionProjectAgents", () => {
  it("the only built-in Agent default_agent: installs every Skill in the library, AGENTS.md is empty", async () => {
    const ids = await provisionProjectAgents();
    expect(ids).toEqual([DEFAULT_AGENT_ID]);
    expect(BUILTIN_AGENT_IDS).toEqual([DEFAULT_AGENT_ID]);

    // name/description are written into system_config; AGENTS.md is an empty file.
    const state = await loadOrInitAgentState({ agentId: DEFAULT_AGENT_ID });
    expect(state.systemConfig.name).toBe("General Agent");
    expect(state.systemConfig.description).toBeTruthy();
    expect(state.agentsMd).toBe("");

    const installed = await listInstalledSkills(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(installed.map((s) => s.name).sort()).toEqual(loadLibrarySkills().map((s) => s.name));
    // On-disk content matches the library's SKILL.md verbatim (install copies the full text).
    const sdkMd = await fs.readFile(skillMdPath(DEFAULT_AGENT_ID, "penguin-sdk"), "utf8");
    expect(sdkMd).toBe(librarySkill("penguin-sdk")!.content);
  });

  it("provision is idempotent: running it again does not change the result", async () => {
    await provisionProjectAgents();
    const ids = await provisionProjectAgents();
    expect(ids).toEqual([DEFAULT_AGENT_ID]);
    const md = await fs.readFile(
      agentsMdPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      "utf8",
    );
    expect(md).toBe("");
    const installed = await listInstalledSkills(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    expect(installed.map((s) => s.name).sort()).toEqual(loadLibrarySkills().map((s) => s.name));
  });

  it("an existing Agent is not overwritten (the preset only applies at initialization)", async () => {
    const custom = "# AGENTS.md\n\nContent the user edited themselves\n";
    await loadOrInitAgentState({ agentId: DEFAULT_AGENT_ID });
    await fs.writeFile(agentsMdPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID), custom, "utf8");

    await provisionProjectAgents();

    const after = await fs.readFile(
      agentsMdPath(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      "utf8",
    );
    expect(after).toBe(custom);
  });
});

describe("Agents Dir / Agent ID placeholders", () => {
  it("assembleSystemPrompt injects Agents Dir and Agent ID (Skill lookup uses agents-dir-relative paths, no .penguin dependency)", async () => {
    const state = await loadOrInitAgentState({ agentId: "env_agent" });
    const prompt = assembleSystemPrompt(state, {
      sessionId: "session-x",
      cwd: "/tmp/ws",
      agentId: "env_agent",
      projectDir: "/tmp/proj",
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      platform: "linux",
      osVersion: "test",
      date: "2026-07-08",
    });
    expect(prompt).toContain("Agent ID: env_agent");
    expect(prompt).toContain("Agents Dir: /tmp/proj/agents");
    expect(prompt).not.toContain("{{AGENT_ID}}");
    expect(prompt).not.toContain("{{AGENTS_DIR}}");
    expect(prompt).not.toContain("{{PROJECT_DIR}}");
    // Skill execution conventions are built from agents-dir-relative paths (no longer reference .penguin).
    expect(prompt).not.toContain(".penguin");
    // Agent State, scratchpad and Skills are addressed under the agents/ container.
    expect(prompt).toContain("<agents_dir>/<agent_id>/agent_state/");
    expect(prompt).toContain("<agents_dir>/<agent_id>/agent_state/skills/");
    // The project dir itself must never be handed to the model — only the agents dir is exposed.
    expect(prompt).not.toContain("<project_dir>");
    expect(prompt).not.toContain("Project Dir:");
  });
});
