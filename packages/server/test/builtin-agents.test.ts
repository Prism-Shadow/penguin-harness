/**
 * Project built-in Agent provisioning: the only built-in Agent is default_agent
 * (pre-installed with every Skill in the library, empty AGENTS.md, cannot be deleted).
 * Specialized capabilities are now carried by Skills — agent_creator / agent_optimizer
 * are no longer built-in Agents: neither provisioned nor deletion-protected.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadLibrarySkills } from "@prismshadow/penguin-skills";
import type { BenchmarksResponse } from "../src/api/types.js";
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

    // Install policy: default_agent is pre-installed with every Skill currently in the library.
    const skillsOf = async (agentId: string) =>
      (
        await fs.readdir(path.join(t.root, projectId, "agents", agentId, "agent_state", "skills"))
      ).sort();
    expect(await skillsOf("default_agent")).toEqual(loadLibrarySkills().map((skill) => skill.name));

    // The default AGENTS.md is empty: it carries no preset guidance (delegation and task
    // conventions live in the default template's Suggested workflows section).
    const defaultMd = await fs.readFile(
      path.join(t.root, projectId, "agents", "default_agent", "agent_state", "AGENTS.md"),
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

  it("default_agent ships a sample Benchmark readable via GET /benchmarks", async () => {
    const projects = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    const projectId = projects.projects[0]!.projectId;
    const res = await owner.get(`/api/projects/${projectId}/agents/default_agent/benchmarks`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as BenchmarksResponse;
    const bench = body.benchmarks.find((b) => b.id === "example-benchmark")!;
    expect(bench).toBeDefined();
    expect(bench.title).toBe("Example Benchmark");
    // description explicitly states it's a built-in sample (the whole directory can be deleted or replaced).
    expect(bench.description).toContain("example");
    expect(bench.runs).toBe(2);
    expect(bench.caseCount).toBe(2);
    expect(bench.evaluations).toHaveLength(3);
    for (const evaluation of bench.evaluations) {
      expect(evaluation.summary).toBeTruthy();
      expect(evaluation.cases).toHaveLength(2);
      for (const c of evaluation.cases) {
        expect(c.runs).toHaveLength(2);
        for (const run of c.runs!) {
          expect(run.sessionId).toMatch(/^session-/);
        }
      }
    }
    // The sample data tells an optimization story: scores increase across evaluation rounds (the evaluation center shows a rising curve out of the box).
    const scores = bench.evaluations.map((e) => e.score);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
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
    expect(res.status).toBe(204);
  });
});
