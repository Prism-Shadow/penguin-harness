/**
 * Project built-in Agent provisioning: the only built-in Agent is default_agent
 * (pre-installed with the library's preinstalled Skill set — `preinstall: false` skills
 * excluded — empty AGENTS.md, cannot be deleted).
 * Specialized capabilities are now carried by Skills — agent_creator / agent_optimizer
 * are no longer built-in Agents: neither provisioned nor deletion-protected.
 * A new Project also starts with its Benchmarks — the example and the five built-ins, written
 * once when it is created — which the Benchmark API lists as plain published Benchmarks, each
 * case statement saying how the case is run. A default_project adopted at bootstrap keeps the
 * Benchmarks it holds and is given only the missing ones.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { benchmarksDir, libraryPlugin, loadPreinstalledPlugins } from "@prismshadow/penguin-core";
import type { BenchmarkCasesResponse, BenchmarksResponse } from "../src/api/types.js";
import { apiClient, createTestApp, loginAdmin, provisionUser, type TestApp } from "./helpers.js";

/** What every built-in Benchmark's id starts with: `penguinharness-benchmark-sec-<letter>`. */
const BUILTIN_PREFIX = "penguinharness-benchmark-sec-";

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

    // Install policy: default_agent is pre-installed with the library's preinstalled set
    // (plugins marked `preinstall: false`, e.g. use-claude-code, stay manual-install only).
    const skillsOf = async (agentId: string) =>
      (
        await fs.readdir(path.join(t.root, projectId, "agents", agentId, "agent_state", "skills"))
      ).sort();
    expect(await skillsOf("default_agent")).toEqual(
      loadPreinstalledPlugins()
        .flatMap((plugin) => plugin.skills.map((skill) => skill.name))
        .sort(),
    );
    // The preinstalled hook packages land beside the skills (the goal plugin ships one).
    const hooksOf = await fs.readdir(
      path.join(t.root, projectId, "agents", "default_agent", "agent_state", "hooks"),
    );
    expect(hooksOf).toContain("goal");
    expect(hooksOf).not.toContain("continual-learning");
    // The hook package carries its plugin's icon beside the manifest, the way an installed skill does.
    expect(
      await fs.readFile(
        path.join(
          t.root,
          projectId,
          "agents",
          "default_agent",
          "agent_state",
          "hooks",
          "goal",
          "icon.svg",
        ),
        "utf8",
      ),
    ).toBe(libraryPlugin("goal")!.icon);

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

  it("a new Project's sample Benchmark is readable via GET /benchmarks", async () => {
    const projects = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    const projectId = projects.projects[0]!.projectId;
    const res = await owner.get(`/api/projects/${projectId}/benchmarks`);
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
    // The sample evaluations all test default_agent, so the Benchmark reports exactly it.
    expect(bench.agentIds).toEqual(["default_agent"]);
    for (const evaluation of bench.evaluations) {
      expect(evaluation.agentId).toBe("default_agent");
      expect(evaluation.thinkingLevel).toBe("medium");
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

  it("a new Project, initial or created, comes with the example and the five built-ins, listed as plain published Benchmarks whose statements say how each case is run", async () => {
    const projects = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner1-bench", name: "Bench" })
    ).json()) as ProjectCreateResponse;
    for (const projectId of [projects.projects[0]!.projectId, created.project.projectId]) {
      const base = `/api/projects/${projectId}/benchmarks`;
      const body = (await (await owner.get(base)).json()) as BenchmarksResponse;
      const example = body.benchmarks.find((b) => b.id === "example-benchmark")!;
      const builtins = body.benchmarks.filter((b) => b.id.startsWith(BUILTIN_PREFIX));
      expect(builtins, projectId).toHaveLength(5);
      expect(body.benchmarks.map((b) => b.id)).toEqual([
        "example-benchmark",
        ...builtins.map((b) => b.id),
      ]);
      for (const bench of builtins) {
        // Read like any Benchmark: nothing in the summary sets a built-in apart.
        expect(Object.keys(bench).sort(), bench.id).toEqual(Object.keys(example).sort());
        // Ready to evaluate, and never evaluated: no baseline ships with them.
        expect(bench.status).toBe("published");
        expect(bench.runs).toBe(1);
        expect(bench.evaluations).toEqual([]);
        expect(bench.caseCount).toBeGreaterThan(0);
        const cases = (await (
          await owner.get(`${base}/${bench.id}/cases`)
        ).json()) as BenchmarkCasesResponse;
        expect(cases.cases).toHaveLength(bench.caseCount);
        for (const c of cases.cases) {
          // Listed under the title its statement opens with.
          expect(c.title).not.toBe(c.id);
          // The statement links the task's folder in the public repository and says how the
          // case is run.
          const statement = await (
            await owner.get(`${base}/${bench.id}/cases/${c.id}/files/content?path=README.md`)
          ).text();
          expect(statement, c.id).toMatch(
            /^- Task: `[^`]+` in https:\/\/github\.com\/\S+\/tree\/\S+$/m,
          );
          expect(statement, c.id).toMatch(/^## How this case is run$/m);
          expect(statement, c.id).toMatch(/harbor run -p \S+ -i \S+ /);
        }
      }
    }
  });

  it("an existing default_project adopted at bootstrap keeps its own Benchmarks and is given only the missing ones", async () => {
    const mine = `${BUILTIN_PREFIX}a`;
    const adopted = await createTestApp({
      // A data root the CLI made before the server's first start, holding a Benchmark of its
      // own under a built-in's id.
      beforeSeed: async (root) => {
        const dir = path.join(benchmarksDir(root, "default_project"), mine);
        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(path.join(dir, "benchmark_config.toml"), 'title = "Mine"\n');
      },
    });
    try {
      const admin = apiClient(adopted.app, (await loginAdmin(adopted.app)).cookie);
      const body = (await (
        await admin.get("/api/projects/default_project/benchmarks")
      ).json()) as BenchmarksResponse;
      const ids = body.benchmarks.map((b) => b.id);
      expect(ids).toContain("example-benchmark");
      expect(ids.filter((id) => id.startsWith(BUILTIN_PREFIX))).toHaveLength(5);
      expect(body.benchmarks.find((b) => b.id === mine)).toMatchObject({
        title: "Mine",
        caseCount: 0,
      });
      expect(
        await fs.readdir(path.join(benchmarksDir(adopted.root, "default_project"), mine)),
      ).toEqual(["benchmark_config.toml"]);
    } finally {
      await adopted.cleanup();
    }
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
