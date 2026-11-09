/**
 * Project built-in Agent provisioning: the only built-in Agent is default_agent
 * (pre-installed with the library's preinstalled Skill set — `preinstall: false` skills
 * excluded — empty AGENTS.md, cannot be deleted).
 * Specialized capabilities are now carried by Skills — agent_creator / agent_optimizer
 * are no longer built-in Agents: neither provisioned nor deletion-protected.
 * A new Project also starts with its Benchmarks — the example and the shipped packages, written
 * once when it is created — which the Benchmark API lists with their packaged metadata, every
 * file of a package copied byte for byte and no evaluations of its own (packages of the test's
 * own stand in for the catalog). The real catalog reaches a Project whole: default_project
 * lists every package the build fetched. A default_project adopted at bootstrap keeps the
 * Benchmarks it holds and is given only the missing ones.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  benchmarksDir,
  loadPreinstalledPlugins,
  readBenchmarkManifest,
  readBuiltinBenchmarks,
  type BuiltinBenchmark,
} from "@prismshadow/penguin-core";
import type { BenchmarksResponse } from "../src/api/types.js";
import {
  apiClient,
  createTestApp,
  loginAdmin,
  makeTempRoot,
  provisionUser,
  type TestApp,
} from "./helpers.js";

interface AgentsResponse {
  agents: Array<{ agentId: string; name?: string; description?: string }>;
}
interface ProjectsResponse {
  projects: Array<{ projectId: string }>;
}
interface ProjectCreateResponse {
  project: { projectId: string };
}

/** The file a Project keeps a Benchmark's evaluations in, never a package's. */
const SCOREBOARD = "scoreboard.yaml";

/** Every file under `dir`, keyed by its path relative to it (posix separators). */
async function filesUnder(dir: string): Promise<Map<string, Buffer>> {
  const out = new Map<string, Buffer>();
  for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    out.set(path.relative(dir, full).split(path.sep).join("/"), await fs.readFile(full));
  }
  return out;
}

/**
 * A Benchmark package as the build would fetch one: a manifest and one case. With `manifest`,
 * the manifest carries everything a shipped one does (id, version, status, runs, origin).
 */
async function writePackage(
  parent: string,
  id: string,
  title: string,
  { manifest = false }: { manifest?: boolean } = {},
): Promise<BuiltinBenchmark> {
  const directory = path.join(parent, id);
  await fs.mkdir(path.join(directory, "CASE-001-task", "statement"), { recursive: true });
  await fs.writeFile(
    path.join(directory, "benchmark_config.toml"),
    manifest
      ? `id = "${id}"\ntitle = "${title}"\nversion = "1.0.0"\nstatus = "published"\nruns = 2\n\n[origin]\nkind = "builtin"\n`
      : `title = "${title}"\n`,
  );
  await fs.writeFile(
    path.join(directory, "CASE-001-task", "statement", "README.md"),
    `# ${title}: the task\n`,
  );
  return { id, directory };
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
    // The preinstalled plugins' hook packages land beside the skills, and no other plugin's.
    const hooksDir = path.join(
      t.root,
      projectId,
      "agents",
      "default_agent",
      "agent_state",
      "hooks",
    );
    const hookPlugins = loadPreinstalledPlugins().filter((plugin) => plugin.hooks !== undefined);
    expect((await fs.readdir(hooksDir).catch(() => [])).sort()).toEqual(
      hookPlugins.map((plugin) => plugin.name).sort(),
    );
    // A hook package carries its plugin's icon beside the manifest, the way an installed skill does.
    for (const plugin of hookPlugins.filter((p) => p.icon !== undefined)) {
      expect(await fs.readFile(path.join(hooksDir, plugin.name, "icon.svg"), "utf8")).toBe(
        plugin.icon,
      );
    }

    // The default AGENTS.md is empty: it carries no preset guidance (delegation and task
    // conventions live in the default template's Suggested workbenches section).
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

  it("the shipped catalog reaches a Project whole: default_project lists the example and every package the build fetched", async () => {
    // The one scenario on the real catalog, on an app that writes it as production does
    // (createTestApp leaves the built-ins out unless asked). Only what holds for any catalog
    // is asserted: the ids, read from the catalog at test time.
    const packages = await readBuiltinBenchmarks();
    const shipped = await createTestApp({ builtinBenchmarks: true });
    try {
      const admin = apiClient(shipped.app, (await loginAdmin(shipped.app)).cookie);
      const body = (await (
        await admin.get("/api/projects/default_project/benchmarks")
      ).json()) as BenchmarksResponse;
      const ids = body.benchmarks.map((b) => b.id);
      expect(ids[0]).toBe("example-benchmark");
      expect(ids.slice(1).sort()).toEqual(packages.map((p) => p.id).sort());
    } finally {
      await shipped.cleanup();
    }
  });

  it("an existing default_project adopted at bootstrap keeps its own Benchmarks and is given only the missing ones", async () => {
    // Two packages of the test's own stand in for the shipped catalog.
    const catalog = await makeTempRoot();
    const packages = [
      await writePackage(catalog, "shipped-one", "Shipped one"),
      await writePackage(catalog, "shipped-two", "Shipped two"),
    ];
    const mine = packages[0]!.id;
    const adopted = await createTestApp({
      builtinBenchmarks: packages,
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
      expect(ids.sort()).toEqual(["example-benchmark", ...packages.map((p) => p.id)].sort());
      expect(body.benchmarks.find((b) => b.id === mine)).toMatchObject({
        title: "Mine",
        caseCount: 0,
      });
      expect(
        await fs.readdir(path.join(benchmarksDir(adopted.root, "default_project"), mine)),
      ).toEqual(["benchmark_config.toml"]);
      // The missing one is given whole.
      expect(body.benchmarks.find((b) => b.id === "shipped-two")).toMatchObject({
        title: "Shipped two",
        caseCount: 1,
      });
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
    expect(res.status).toBe(202);
  });
});

describe("the shipped Benchmarks a new Project is written with", () => {
  // Two packages of the test's own stand in for the catalog: one with nested and binary files,
  // one carrying a scoreboard of its own that a Project must not inherit. The app writes them into
  // every Project it creates, as production writes the catalog: the Projects are created once,
  // here, and each scenario only reads its own back.
  let shipped: TestApp | undefined;
  let owner: ReturnType<typeof apiClient>;
  let packages: BuiltinBenchmark[];
  const projectIds = { initial: "", created: "" };

  beforeAll(async () => {
    const catalog = await makeTempRoot();
    packages = [
      await writePackage(catalog, "shipped-one", "Shipped one", { manifest: true }),
      await writePackage(catalog, "shipped-two", "Shipped two", { manifest: true }),
    ];
    await fs.mkdir(path.join(packages[0]!.directory, "CASE-001-task", "statement", "assets"));
    await fs.writeFile(
      path.join(packages[0]!.directory, "CASE-001-task", "statement", "assets", "table.bin"),
      Buffer.from(Array.from({ length: 256 }, (_, i) => i)),
    );
    await fs.writeFile(
      path.join(packages[1]!.directory, SCOREBOARD),
      "evaluations:\n  - agent_id: default_agent\n",
    );
    shipped = await createTestApp({ builtinBenchmarks: packages });
    owner = apiClient(shipped.app, (await provisionUser(shipped.app, "owner1")).cookie);
    const projects = (await (await owner.get("/api/projects")).json()) as ProjectsResponse;
    projectIds.initial = projects.projects[0]!.projectId;
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner1-bench", name: "Bench" })
    ).json()) as ProjectCreateResponse;
    projectIds.created = created.project.projectId;
  });
  afterAll(async () => {
    await shipped?.cleanup();
  });

  it.each([
    ["the initial Project made at account setup", "initial"],
    ["a Project created afterwards", "created"],
  ] as const)(
    "%s comes with the example and the shipped packages, copied unchanged with their metadata and statements",
    async (_, kind) => {
      const projectId = projectIds[kind];
      const base = `/api/projects/${projectId}/benchmarks`;
      const body = (await (await owner.get(base)).json()) as BenchmarksResponse;
      const ids = body.benchmarks.map((b) => b.id);
      expect(ids[0], projectId).toBe("example-benchmark");
      expect(ids.slice(1).sort(), projectId).toEqual(packages.map((p) => p.id).sort());
      expect(body.benchmarks[0]!.origin).toEqual({ kind: "builtin" });
      for (const source of packages) {
        const bench = body.benchmarks.find((b) => b.id === source.id)!;
        const manifest = (await readBenchmarkManifest(source.directory))!;
        expect(bench, source.id).toMatchObject({
          title: manifest.title,
          origin: manifest.origin,
          version: manifest.version,
          status: manifest.status,
          runs: manifest.runs,
          caseCount: 1,
          // No baseline comes with a package, whatever its directory holds.
          evaluations: [],
        });
        // The case's statement is served as the package wrote it.
        const statement = await (
          await owner.get(`${base}/${source.id}/cases/CASE-001-task/files/content?path=README.md`)
        ).text();
        expect(statement, source.id).toBe(
          await fs.readFile(
            path.join(source.directory, "CASE-001-task", "statement", "README.md"),
            "utf8",
          ),
        );
        // Every file the package ships is the Project's, byte for byte; only the scoreboard
        // is the Project's own.
        const copy = await filesUnder(
          path.join(benchmarksDir(shipped!.root, projectId), source.id),
        );
        const shippedFiles = await filesUnder(source.directory);
        shippedFiles.delete(SCOREBOARD);
        expect([...copy.keys()].filter((f) => f !== SCOREBOARD).sort(), source.id).toEqual(
          [...shippedFiles.keys()].sort(),
        );
        for (const [file, bytes] of shippedFiles) {
          expect(copy.get(file)?.equals(bytes), `${source.id}/${file}`).toBe(true);
        }
      }
    },
  );
});
