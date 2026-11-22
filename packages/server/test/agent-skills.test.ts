/**
 * AgentSkills (PRFC-0036's read views): the Skills installed on one Agent, by name, as a server
 * module reaches them — a plugin module booted into the real platform tree declaring its own view
 * of the interface, as the Self-Evolution Workbench's package does.
 *
 * - Given an Agent's `skills/`, the answer is the names of its folders that hold a SKILL.md,
 *   sorted: a folder without one, a staging folder and a stray file are no Skill.
 * - An Agent with no `skills/` folder has none.
 * - An Agent the Project does not have is 404 `agent_not_found`; an id that is not one plain
 *   segment is 400.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { skillsDir } from "@prismshadow/penguin-core";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
import type { IfaceTable } from "@prismshadow/penguin-core/kernel";
import table from "../src/ifaces.json" with { type: "json" };
import { PluginHost } from "../src/plugin/host.js";
import type { AgentSkills } from "../src/services/agent-skills.js";
import { apiClient, createTestApp, loginAdmin } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const PROJECT = "default_project";
const VIEW_KEY = "@acme/skills#AgentSkills";

describe("AgentSkills", () => {
  let t: TestApp;
  const seen: { skills?: AgentSkills } = {};

  beforeAll(async () => {
    // The plugin's own view: the host's declaration, as its build copies it under its own key.
    const host = (table as unknown as IfaceTable).ifaces[
      "@prismshadow/penguin-server#AgentSkills"
    ]!;
    const plugins = new PluginHost();
    plugins.use({
      specifier: "@acme/skills",
      modules: [
        {
          manifest: parseManifest({
            name: "AcmeSkills",
            requires: { skills: { iface: VIEW_KEY } },
            provides: {},
            contributes: {},
            children: [],
          }),
          create({ use }) {
            seen.skills = use.skills as AgentSkills;
            return { api: {} };
          },
        },
      ],
      replaces: [],
      ifaces: { ifaces: { [VIEW_KEY]: host }, types: {} },
    });
    t = await createTestApp({ plugins });
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    for (const agentId of ["reviewer", "blank"]) {
      expect((await admin.post(`/api/projects/${PROJECT}/agents`, { agentId })).status).toBe(201);
      await fs.rm(skillsDir(t.root, PROJECT, agentId), { recursive: true, force: true });
    }
    const skills = skillsDir(t.root, PROJECT, "reviewer");
    for (const [rel, body] of Object.entries({
      "benchmark-design/SKILL.md": "---\nname: benchmark-design\n---\n",
      "agent-evaluation/SKILL.md": "---\nname: agent-evaluation\n---\n",
      "agent-evaluation/reference/harbor.md": "notes",
      "half-written/notes.md": "no SKILL.md here",
      ".staging-1/SKILL.md": "---\nname: staging\n---\n",
      "README.md": "a stray file",
    })) {
      await fs.mkdir(path.dirname(path.join(skills, rel)), { recursive: true });
      await fs.writeFile(path.join(skills, rel), body);
    }
  });
  afterAll(async () => {
    await t.cleanup();
  });

  const skills = () => seen.skills!;

  it("names the Agent's Skill folders that hold a SKILL.md, sorted", async () => {
    expect(await skills().installedSkills(PROJECT, "reviewer")).toEqual([
      "agent-evaluation",
      "benchmark-design",
    ]);
  });

  it("answers none for an Agent with no skills folder", async () => {
    expect(await skills().installedSkills(PROJECT, "blank")).toEqual([]);
  });

  it("is 404 for an Agent the Project lacks and 400 for an id that is not one segment", async () => {
    await expect(skills().installedSkills(PROJECT, "ghost")).rejects.toMatchObject({
      status: 404,
      code: "agent_not_found",
    });
    await expect(skills().installedSkills(PROJECT, "../reviewer")).rejects.toMatchObject({
      status: 400,
    });
  });
});
