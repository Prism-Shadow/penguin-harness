/**
 * The startup migration to the Self-Evolution Workbench of `@penguinharness/rsi-workbench`
 * (services/rsi-workbench-migration.ts), over a data root shaped like 0.2.19 by the test: the
 * Projects are made by this build and then given what a 0.2.19 server left in them — the in-repo
 * `agent-evaluation` workbench (test/fixtures/agent-evaluation-workbench.ts), the Benchmarks in the
 * system Agent's data folder, a Harbor checkout beside them — with their ledger rows taken away;
 * the next start is the upgrade.
 *
 * - An unedited in-repo workbench, on the default Agent or another, becomes the package's: its
 *   receipt names `rsi-workbench`, its files are the package's, and its `.disabled` and
 *   `.hidden-from-sidebar` markers and its App Center switch stay. An edited one is left as it is
 *   and reads as `rsi-workbench`'s, an update behind.
 * - The system Agent's Benchmarks move into the default Agent's workbench data, with `.seeded`
 *   written, `.harbor/` moved to the workbench's cache folder and a link left at the old place,
 *   whatever is still running in `.jobs/` (said in one log line).
 * - A Project whose `system_agent` is an Agent of the user's has its old `benchmarks/` moved.
 * - A same-id Benchmark already in the target stays where it is with a log line, the old folder is
 *   kept and the Project unfinished; once that is resolved, the next start moves the rest and links.
 * - A Project without a default Agent gets one first; one that cannot be provisioned keeps its data,
 *   is not recorded, and is migrated at a later start once it can be.
 * - A default Agent without the workbench gets it installed once; removed afterwards, it does not
 *   come back.
 * - A run cut short between the move and the link is finished from what is on disk.
 * - A Project this build creates is recorded at its creation and never migrated; a migrated root
 *   starts again with nothing to do.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  agentDir,
  legacyBenchmarksDir,
  libraryPlugin,
  listInstalledWorkbenches,
  systemConfigPath,
  workbenchCacheDir,
  workbenchDataDir,
  workbenchesDir,
} from "@prismshadow/penguin-core";
import { INSTALL, MIGRATION, MOVE } from "../src/services/rsi-workbench-migration.js";
import { writeAgentEvaluationWorkbench } from "./fixtures/agent-evaluation-workbench.js";
import { apiClient, createTestApp, loginAdmin, restartTestApp, type TestApp } from "./helpers.js";

const DEFAULT = "default_agent";
const SYSTEM = "system_agent";

/** Where the default Agent keeps its Self-Evolution Workbench's Benchmarks. */
const targetOf = (root: string, p: string) => workbenchDataDir(root, p, DEFAULT, "benchmark");
/** Where the system Agent kept the Project's Benchmarks in 0.2.19. */
const sourceOf = (root: string, p: string) => workbenchDataDir(root, p, SYSTEM, "benchmark");
const workbenchOf = (root: string, p: string, a: string) =>
  path.join(workbenchesDir(root, p, a), "benchmark");

async function write(file: string, text = ""): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, "utf8");
}

/** A Benchmark folder with a manifest, as the 0.2.19 Evaluation Center left one. */
async function benchmark(dir: string, id: string): Promise<void> {
  await write(path.join(dir, id, "benchmark_config.toml"), `id = "${id}"\ntitle = "${id}"\n`);
}

const exists = (p: string) =>
  fs.lstat(p).then(
    () => true,
    () => false,
  );

async function receiptOf(dir: string): Promise<string> {
  return (JSON.parse(await fs.readFile(path.join(dir, ".plugin.json"), "utf8")) as { plugin: string })
    .plugin;
}

function ledgerRow(t: TestApp, name: string, projectId: string) {
  return t.deps.db
    .prepare(
      "SELECT begun_at, finished_at FROM project_data_migrations WHERE name = ? AND project_id = ?",
    )
    .get(name, projectId) as { begun_at: string; finished_at: string | null } | undefined;
}

/** Restarts `t` as the next process would, keeping the migration's log lines. */
async function restart(t: TestApp): Promise<{ t: TestApp; lines: string[] }> {
  const lines: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((line: unknown) => {
    if (typeof line === "string" && line.startsWith("[rsi-workbench]")) lines.push(line);
  });
  try {
    return { t: await restartTestApp(t), lines };
  } finally {
    spy.mockRestore();
  }
}

describe("the startup migration to the Self-Evolution Workbench", { timeout: 120_000 }, () => {
  let t: TestApp;
  let lines: string[];
  let root: string;
  let packageIndex: string;

  beforeAll(async () => {
    const first = await createTestApp({ durableDatabase: true });
    root = first.root;
    const admin = apiClient(first.app, (await loginAdmin(first.app)).cookie);
    for (const projectId of ["evals", "clash", "held", "bare", "stuck", "lacking", "cut", "fresh"]) {
      const res = await admin.post("/api/projects", { projectId, name: projectId });
      expect(res.status, await res.text()).toBe(201);
    }
    for (const agentId of ["evaluator", "tinker"]) {
      const res = await admin.post("/api/projects/evals/agents", { agentId });
      expect(res.status, await res.text()).toBe(201);
    }
    packageIndex = libraryPlugin("rsi-workbench")!.workbenches!.find((w) => w.name === "benchmark")!
      .files["index.ts"]!;

    // evals: the in-repo workbench on three Agents — the default one hidden from the sidebar and
    // off the App Center, another switched off, a third edited — and Benchmarks with a Harbor
    // checkout and an evaluation still running.
    const evalsDefault = workbenchOf(root, "evals", DEFAULT);
    await fs.rm(evalsDefault, { recursive: true, force: true });
    await writeAgentEvaluationWorkbench(evalsDefault, (files) => {
      const pkg = JSON.parse(files["package.json"]!) as {
        penguin: { appCenter: Record<string, unknown> };
      };
      pkg.penguin.appCenter.show = false;
      files["package.json"] = `${JSON.stringify(pkg, null, 2)}\n`;
    });
    await write(path.join(evalsDefault, ".hidden-from-sidebar"));
    const evaluator = workbenchOf(root, "evals", "evaluator");
    await fs.rm(evaluator, { recursive: true, force: true });
    await writeAgentEvaluationWorkbench(evaluator);
    await write(path.join(evaluator, ".disabled"));
    const tinker = workbenchOf(root, "evals", "tinker");
    await fs.rm(tinker, { recursive: true, force: true });
    await writeAgentEvaluationWorkbench(tinker, (files) => {
      files["index.ts"] += "// mine\n";
    });
    const evalsSource = sourceOf(root, "evals");
    await benchmark(evalsSource, "alpha");
    await benchmark(evalsSource, "beta");
    await write(path.join(evalsSource, "beta", ".jobs", "job-1", "trial-1", "agent.log"), "…");
    await write(path.join(evalsSource, ".harbor", "README.md"), "harbor");

    // clash: the target already holds a Benchmark of one of the moving ids.
    await benchmark(sourceOf(root, "clash"), "shared");
    await benchmark(sourceOf(root, "clash"), "solo");
    await write(path.join(targetOf(root, "clash"), "shared", "benchmark_config.toml"), "mine");

    // held: its system_agent is an Agent of the user's, so its Benchmarks are in `benchmarks/`.
    const config = systemConfigPath(root, "held", SYSTEM);
    const own = parseYaml(await fs.readFile(config, "utf8")) as Record<string, unknown>;
    delete own.system;
    await fs.writeFile(config, stringifyYaml(own), "utf8");
    await benchmark(legacyBenchmarksDir(root, "held"), "gamma");

    // bare: no default Agent at all; stuck: one that cannot be provisioned (a file in its place).
    await fs.rm(agentDir(root, "bare", DEFAULT), { recursive: true, force: true });
    await benchmark(sourceOf(root, "bare"), "delta");
    await fs.rm(agentDir(root, "stuck", DEFAULT), { recursive: true, force: true });
    await write(agentDir(root, "stuck", DEFAULT), "not a folder");
    await benchmark(sourceOf(root, "stuck"), "eta");

    // lacking: a default Agent without the workbench.
    await fs.rm(workbenchOf(root, "lacking", DEFAULT), { recursive: true, force: true });
    await benchmark(sourceOf(root, "lacking"), "epsilon");

    // cut: a run that stopped after moving the folder, before leaving the link.
    await benchmark(targetOf(root, "cut"), "zeta");

    const db = first.deps.db;
    db.prepare("DELETE FROM project_data_migrations WHERE project_id != 'fresh'").run();
    for (const name of [MIGRATION, MOVE]) {
      db.prepare(
        "INSERT INTO project_data_migrations (name, project_id, begun_at) VALUES (?, 'cut', '2026-11-26T00:00:00.000Z')",
      ).run(name);
    }
    ({ t, lines } = await restart(first));
  }, 120_000);
  afterAll(async () => {
    await t?.cleanup();
  });

  it("replaces an unedited in-repo workbench with the package's, keeping its markers and switch", async () => {
    for (const agent of [DEFAULT, "evaluator"]) {
      const dir = workbenchOf(root, "evals", agent);
      expect(await receiptOf(dir)).toBe("rsi-workbench");
      expect(await fs.readFile(path.join(dir, "index.ts"), "utf8")).toBe(packageIndex);
    }
    const hidden = workbenchOf(root, "evals", DEFAULT);
    expect(await exists(path.join(hidden, ".hidden-from-sidebar"))).toBe(true);
    const manifest = JSON.parse(await fs.readFile(path.join(hidden, "package.json"), "utf8")) as {
      penguin: { appCenter: { show?: boolean }; version: string };
    };
    expect(manifest.penguin.appCenter.show).toBe(false);
    expect(manifest.penguin.version > "2026.11.25.1").toBe(true);
    expect(await exists(path.join(workbenchOf(root, "evals", "evaluator"), ".disabled"))).toBe(true);
  });

  it("leaves an edited copy as it is and reads it as rsi-workbench's, an update behind", async () => {
    const dir = workbenchOf(root, "evals", "tinker");
    expect(await receiptOf(dir)).toBe("agent-evaluation");
    expect(await fs.readFile(path.join(dir, "index.ts"), "utf8")).toContain("// mine");
    const admin = apiClient(t.app, (await loginAdmin(t.app)).cookie);
    const listed = (await (await admin.get("/api/projects/evals/agents/tinker/plugins")).json()) as {
      workbenches: { name: string; plugin: string; version: string }[];
    };
    expect(listed.workbenches).toEqual([
      { name: "benchmark", plugin: "rsi-workbench", version: "2026.11.25.1" },
    ]);
    expect(lines.some((l) => l.includes("evals/tinker") && l.includes("stays as it is"))).toBe(true);
  });

  it("moves the system Agent's Benchmarks into the default Agent's workbench, Harbor into its cache, and links the old folder", async () => {
    const target = targetOf(root, "evals");
    expect((await fs.readdir(target)).sort()).toEqual([".seeded", "alpha", "beta"]);
    expect(await fs.readFile(path.join(target, "beta", ".jobs", "job-1", "trial-1", "agent.log"), "utf8")).toBe("…");
    const source = sourceOf(root, "evals");
    expect((await fs.lstat(source)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(source)).toBe(await fs.realpath(target));
    const harbor = path.join(workbenchCacheDir(root, "evals", DEFAULT, "benchmark"), "harbor");
    expect(await fs.readFile(path.join(harbor, "README.md"), "utf8")).toBe("harbor");
    expect(lines.filter((l) => l.includes("evals:") && l.includes("still running"))).toHaveLength(1);
    expect(lines.find((l) => l.includes("still running"))).toContain("beta");
    for (const name of [MIGRATION, MOVE, INSTALL]) {
      expect(ledgerRow(t, name, "evals")?.finished_at).toEqual(expect.any(String));
    }
  });

  it("moves the old benchmarks/ of a Project whose system_agent is the user's", async () => {
    expect(await fs.readdir(targetOf(root, "held"))).toEqual(expect.arrayContaining(["gamma"]));
    expect((await fs.lstat(legacyBenchmarksDir(root, "held"))).isSymbolicLink()).toBe(true);
    expect(await exists(sourceOf(root, "held"))).toBe(false);
  });

  it("leaves a same-id Benchmark where it is, keeps the old folder and finishes nothing", async () => {
    expect((await fs.readdir(targetOf(root, "clash"))).sort()).toEqual([".seeded", "shared", "solo"]);
    expect(await fs.readFile(path.join(targetOf(root, "clash"), "shared", "benchmark_config.toml"), "utf8")).toBe("mine");
    const source = sourceOf(root, "clash");
    expect((await fs.lstat(source)).isDirectory()).toBe(true);
    expect(await fs.readdir(source)).toEqual(["shared"]);
    expect(lines.some((l) => l.includes(path.join(source, "shared")) && l.includes("stays where it is"))).toBe(true);
    expect(ledgerRow(t, MIGRATION, "clash")?.finished_at).toBeNull();
  });

  it("provisions a missing default Agent first, and keeps one it cannot provision for a later start", async () => {
    expect(await exists(systemConfigPath(root, "bare", DEFAULT))).toBe(true);
    expect(await receiptOf(workbenchOf(root, "bare", DEFAULT))).toBe("rsi-workbench");
    expect(await fs.readdir(targetOf(root, "bare"))).toEqual(expect.arrayContaining(["delta"]));
    expect(await fs.readdir(sourceOf(root, "stuck"))).toEqual(["eta"]);
    expect(ledgerRow(t, MIGRATION, "stuck")).toBeUndefined();
    expect(lines.some((l) => l.startsWith("[rsi-workbench] stuck:"))).toBe(true);
  });

  it("installs the workbench once on a default Agent that has none", async () => {
    expect(await receiptOf(workbenchOf(root, "lacking", DEFAULT))).toBe("rsi-workbench");
    expect(await fs.readdir(targetOf(root, "lacking"))).toEqual(expect.arrayContaining(["epsilon"]));
    expect(ledgerRow(t, INSTALL, "lacking")?.finished_at).toEqual(expect.any(String));
  });

  it("finishes a run cut short between the move and the link", async () => {
    const source = sourceOf(root, "cut");
    expect((await fs.lstat(source)).isSymbolicLink()).toBe(true);
    expect(await fs.realpath(path.join(source, "zeta"))).toBe(
      await fs.realpath(path.join(targetOf(root, "cut"), "zeta")),
    );
    expect(ledgerRow(t, MIGRATION, "cut")?.finished_at).toEqual(expect.any(String));
    expect(ledgerRow(t, MOVE, "cut")?.finished_at).toEqual(expect.any(String));
  });

  it("never touches a Project this build created", async () => {
    expect(lines.some((l) => l.includes(" fresh"))).toBe(false);
    expect(await exists(sourceOf(root, "fresh"))).toBe(false);
    expect((await listInstalledWorkbenches(root, "fresh", DEFAULT)).map((w) => w.plugin)).toContain(
      "rsi-workbench",
    );
  });

  it("at the next start: moves what was left once resolved, provisions what it could not, and does not bring a removed workbench back", async () => {
    await fs.rm(path.join(targetOf(root, "clash"), "shared"), { recursive: true });
    await fs.rm(agentDir(root, "stuck", DEFAULT), { force: true });
    await fs.rm(workbenchOf(root, "lacking", DEFAULT), { recursive: true });
    const evalsReceipt = await fs.readFile(
      path.join(workbenchOf(root, "evals", DEFAULT), ".plugin.json"),
      "utf8",
    );

    ({ t, lines } = await restart(t));

    expect((await fs.readdir(targetOf(root, "clash"))).sort()).toEqual([".seeded", "shared", "solo"]);
    expect((await fs.lstat(sourceOf(root, "clash"))).isSymbolicLink()).toBe(true);
    expect(ledgerRow(t, MIGRATION, "clash")?.finished_at).toEqual(expect.any(String));
    expect(await fs.readdir(targetOf(root, "stuck"))).toEqual(expect.arrayContaining(["eta"]));
    expect(await exists(workbenchOf(root, "lacking", DEFAULT))).toBe(false);
    // The finished Projects are not looked at again.
    expect(lines.filter((l) => /\] (evals|held|bare|lacking|cut)[:/]/.test(l))).toEqual([]);
    expect(
      await fs.readFile(path.join(workbenchOf(root, "evals", DEFAULT), ".plugin.json"), "utf8"),
    ).toBe(evalsReceipt);
  });
});
