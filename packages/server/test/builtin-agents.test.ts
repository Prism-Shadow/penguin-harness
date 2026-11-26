/**
 * Project built-in Agent provisioning: the only built-in Agent is default_agent
 * (pre-installed with the library's preinstalled Skill set — `preinstall: false` skills
 * excluded — empty AGENTS.md, cannot be deleted).
 * Specialized capabilities are now carried by Skills — agent_creator / agent_optimizer
 * are no longer built-in Agents: neither provisioned nor deletion-protected.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadPreinstalledPlugins } from "@prismshadow/penguin-core";
import { apiClient, createTestApp, provisionUser, type TestApp } from "./helpers.js";

interface AgentsResponse {
  agents: Array<{ agentId: string; name?: string; description?: string }>;
}
interface ProjectsResponse {
  projects: Array<{ projectId: string }>;
}
interface ProjectCreateResponse {
  project: { projectId: string };
}

describe("built-in Agent provisioning", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;

  beforeEach(async () => {
    t = await createTestApp();
    const reg = await provisionUser(t.app, "owner1");
    owner = apiClient(t.app, reg.cookie);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  async function expectBuiltinAgents(projectId: string): Promise<void> {
    const list = (await (
      await owner.get(`/api/projects/${projectId}/agents`)
    ).json()) as AgentsResponse;
    const ids = list.agents.map((a) => a.agentId);
    // The only built-in Agent: default_agent is listed first with a display name; specialized Agents are no longer provisioned.
    expect(ids[0]).toBe("default_agent");
    expect(ids).not.toContain("agent_creator");
    expect(ids).not.toContain("agent_optimizer");
    expect(list.agents.find((a) => a.agentId === "default_agent")?.name).toBe("General Agent");

    const preinstalled = loadPreinstalledPlugins();
    const agentBaseline = [
      "a2ui",
      "skill-porting",
      "agent-company",
      "agent-development",
      "browser-automation",
      "computer-use",
      "data-analysis",
      "default-rsi-toolkit",
      "goal",
      "model-development",
      "multimodal-tools",
      "plan",
      "rsi-workbench",
      "software-development",
      "storage",
      "trace-lookup",
      "use-bento-slides",
    ];
    expect(preinstalled.map((plugin) => plugin.name)).toEqual(
      expect.arrayContaining(agentBaseline),
    );
    expect(
      preinstalled.map((plugin) => plugin.name).filter((name) => name.endsWith("-rsi-toolkit")),
    ).toEqual(["default-rsi-toolkit"]);
    expect(preinstalled.map((plugin) => plugin.name)).not.toContain("agent-state-git");
    expect(preinstalled.map((plugin) => plugin.name)).not.toContain("penguin-support");
    // Its stop hook starts a background Session after a long Task: a person installs it.
    expect(preinstalled.map((plugin) => plugin.name)).not.toContain("continual-learning");
    const installedWorkbenches = path.join(
      t.root,
      "projects",
      projectId,
      "agents",
      "default_agent",
      "agent_state",
      "workbenches",
    );
    await expect(fs.access(path.join(installedWorkbenches, "support"))).rejects.toMatchObject({
      code: "ENOENT",
    });
    await expect(
      fs.access(path.join(installedWorkbenches, "benchmark", "package.json")),
    ).resolves.toBeUndefined();
    for (const plugin of preinstalled) {
      for (const workbench of plugin.workbenches ?? []) {
        const manifest = await fs.readFile(
          path.join(installedWorkbenches, workbench.name, "package.json"),
          "utf8",
        );
        expect(JSON.parse(manifest).penguin.version).toBe(workbench.version);
      }
    }
    const skillsOf = async (agentId: string) =>
      (
        await fs.readdir(
          path.join(t.root, "projects", projectId, "agents", agentId, "agent_state", "skills"),
        )
      ).sort();
    expect(await skillsOf("default_agent")).toEqual(
      preinstalled.flatMap((plugin) => plugin.skills.map((skill) => skill.name)).sort(),
    );
    // The preinstalled plugins' hook packages land beside the skills, and no other plugin's.
    const hooksDir = path.join(
      t.root,
      "projects",
      projectId,
      "agents",
      "default_agent",
      "agent_state",
      "hooks",
    );
    const hookPlugins = preinstalled.filter((plugin) => plugin.hooks !== undefined);
    expect((await fs.readdir(hooksDir).catch(() => [])).sort()).toEqual(
      hookPlugins.map((plugin) => plugin.name).sort(),
    );
    // A hook package carries its plugin's icon beside the manifest, the way an installed skill does.
    for (const plugin of hookPlugins.filter((p) => p.icon !== undefined)) {
      expect(await fs.readFile(path.join(hooksDir, plugin.name, "icon.svg"))).toEqual(
        Buffer.from(plugin.icon!.bytes),
      );
    }

    // The default AGENTS.md is empty: it carries no preset guidance (delegation and task
    // conventions live in the default template's Suggested workbenches section).
    const defaultMd = await fs.readFile(
      path.join(
        t.root,
        "projects",
        projectId,
        "agents",
        "default_agent",
        "agent_state",
        "AGENTS.md",
      ),
      "utf8",
    );
    expect(defaultMd).toBe("");
  }

  it("the initial Project created at account setup comes with default_agent", async () => {
    const projects = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    await expectBuiltinAgents(projects.projects[0]!.projectId);
  });

  it("a newly created Project also comes with default_agent", async () => {
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner1-new", name: "New project" })
    ).json()) as ProjectCreateResponse;
    await expectBuiltinAgents(created.project.projectId);
  });

  it("default_agent cannot be deleted (409)", async () => {
    const projects = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    const projectId = projects.projects[0]!.projectId;
    const res = await owner.delete(`/api/projects/${projectId}/agents/default_agent`);
    expect(res.status).toBe(409);
  });

  it("legacy ids like agent_creator lose built-in protection: creatable, deletable", async () => {
    const projects = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    const projectId = projects.projects[0]!.projectId;
    const created = await owner.post(`/api/projects/${projectId}/agents`, {
      agentId: "agent_creator",
    });
    expect(created.status).toBe(201);
    const res = await owner.delete(`/api/projects/${projectId}/agents/agent_creator`);
    expect(res.status).toBe(202);
  });
});
