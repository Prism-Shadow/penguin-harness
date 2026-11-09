/**
 * The example Benchmark, as a new Project's provisioning writes it.
 *
 * - A new Project's provisioning writes the Project-level benchmarks/example-benchmark/: a
 *   manifest the reader takes (seeded as builtin, a date version, no model), Cases with a
 *   statement and a rubric, and a scoreboard of self-consistent evaluations in time order, each
 *   labelled with the Agent it tested and scoring every Case.
 * - These scenarios provision an empty catalogue of shipped packages: only the example is
 *   under test.
 * - Benchmarks of the user's own, and a copy at the retired per-agent location, do not stand in
 *   for it, and are left as they are.
 * - No Agent writes it: initializing or loading default_agent leaves a deleted example deleted,
 *   and creating an ordinary Agent writes no Benchmark.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";
import {
  DEFAULT_AGENT_ID,
  DEFAULT_PROJECT_ID,
  EXAMPLE_BENCHMARK_ID,
  agentStateDir,
  benchmarksDir,
  buildExampleScoreboard,
  loadAgentState,
  provisionProjectBenchmarks,
  readBenchmarkManifest,
} from "../src/state/index.js";

let tmpRoot: string;
let prevHome: string | undefined;

beforeEach(async () => {
  prevHome = process.env.PENGUIN_HOME;
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "penguin-bench-"));
  process.env.PENGUIN_HOME = tmpRoot;
});

afterEach(async () => {
  if (prevHome === undefined) delete process.env.PENGUIN_HOME;
  else process.env.PENGUIN_HOME = prevHome;
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

interface RunScore {
  score: number;
  cost: number | null;
  duration_ms: number;
  session_id: string;
}
interface CaseScore extends Omit<RunScore, "session_id"> {
  case: string;
  runs: RunScore[];
}
interface Evaluation extends Omit<CaseScore, "case" | "runs"> {
  time: string;
  agent_id: string;
  version: number;
  provider: string;
  model_id: string;
  thinking_level: string;
  summary_title: string;
  summary: string;
  cases: CaseScore[];
}

describe("example benchmark provisioning", () => {
  it("a new Project's example Benchmark reads as a builtin, dated, model-free package whose scoreboard scores its own Cases", async () => {
    await provisionProjectBenchmarks(tmpRoot, DEFAULT_PROJECT_ID, []);
    const dir = path.join(benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID), EXAMPLE_BENCHMARK_ID);

    // The manifest reads through the reader every Benchmark surface uses: seeded as builtin, with
    // a date version, and no model reference (the model is recorded on each evaluation instead).
    const manifest = await readBenchmarkManifest(dir);
    expect(manifest).toMatchObject({ id: EXAMPLE_BENCHMARK_ID, origin: { kind: "builtin" } });
    expect(manifest?.version).toMatch(/^\d{4}\.\d{2}\.\d{2}\.\d+$/);
    const config = parseToml(await fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8"));
    expect(config).not.toHaveProperty("provider");
    expect(config).not.toHaveProperty("model_id");

    // Every Case has a statement and a rubric, each indexed by its README.md.
    const cases = (await fs.readdir(dir)).filter((name) => name.startsWith("CASE-")).sort();
    expect(cases.length).toBeGreaterThan(0);
    for (const caseId of cases) {
      for (const part of ["statement", "rubric"]) {
        expect(await exists(path.join(dir, caseId, part, "README.md")), `${caseId}/${part}`).toBe(
          true,
        );
      }
    }

    // The scoreboard's evaluations come in time order, each tested default_agent (which every
    // Project has) on every Case, and each run names its Session by a Session id.
    const scoreboard = parseYaml(await fs.readFile(path.join(dir, "scoreboard.yaml"), "utf8")) as {
      evaluations: Evaluation[];
    };
    expect(scoreboard.evaluations.length).toBeGreaterThan(0);
    expect(JSON.stringify(scoreboard)).not.toContain("max_score");
    const times = scoreboard.evaluations.map((e) => new Date(e.time).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (const e of scoreboard.evaluations) {
      expect(e.agent_id).toBe(DEFAULT_AGENT_ID);
      expect(e.cases.map((c) => c.case).sort()).toEqual(cases);
      for (const c of e.cases) {
        for (const r of c.runs) {
          expect(r.session_id).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/);
        }
      }
    }
  });

  it("scoreboard numbers preserve Run cost precision and use model-written averages", async () => {
    const { evaluations } = buildExampleScoreboard();
    expect(evaluations[0]?.cases[0]?.runs.map((run) => run.cost)).toEqual([0.012, 0.014]);
    const avg = (vals: number[]): number => vals.reduce((a, b) => a + b, 0) / vals.length;
    const knownCostAvg = (vals: Array<number | null>): number | null => {
      const known = vals.filter((value): value is number => value !== null);
      return known.length > 0 ? avg(known) : null;
    };
    for (const e of evaluations) {
      for (const c of e.cases) {
        expect(c.runs.every((run) => run.score >= 0 && run.score <= 100)).toBe(true);
        expect(c.score).toBe(Math.round(avg(c.runs.map((r) => r.score)) * 100) / 100);
        const expectedCost = knownCostAvg(c.runs.map((r) => r.cost));
        expect(c.cost).toBe(
          expectedCost === null ? null : Math.round(expectedCost * 1_000_000) / 1_000_000,
        );
        expect(c.duration_ms).toBe(Math.round(avg(c.runs.map((r) => r.duration_ms))));
      }
      expect(e.score).toBe(Math.round(avg(e.cases.map((c) => c.score)) * 100) / 100);
      const expectedCost = knownCostAvg(e.cases.map((c) => c.cost));
      expect(e.cost).toBe(
        expectedCost === null ? null : Math.round(expectedCost * 1_000_000) / 1_000_000,
      );
      expect(e.duration_ms).toBe(Math.round(avg(e.cases.map((c) => c.duration_ms))));
    }
  });

  it("provisionProjectBenchmarks writes the example at the Project level, for any Project", async () => {
    await provisionProjectBenchmarks(tmpRoot, "proj_x", []);
    expect(await exists(path.join(benchmarksDir(tmpRoot, "proj_x"), EXAMPLE_BENCHMARK_ID))).toBe(
      true,
    );
  });

  it("writes the example beside Benchmarks the user already keeps, touching none of them", async () => {
    const dir = benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID);
    // A default_project adopted from a data root the CLI made can hold Benchmarks of its own
    // and no example.
    await fs.mkdir(path.join(dir, "swe-bench-v1"), { recursive: true });
    await fs.writeFile(path.join(dir, "swe-bench-v1", "benchmark_config.toml"), 'title = "mine"\n');
    await provisionProjectBenchmarks(tmpRoot, DEFAULT_PROJECT_ID, []);
    expect(await fs.readdir(dir)).toEqual(
      expect.arrayContaining([EXAMPLE_BENCHMARK_ID, "swe-bench-v1"]),
    );
    expect(await fs.readFile(path.join(dir, "swe-bench-v1", "benchmark_config.toml"), "utf8")).toBe(
      'title = "mine"\n',
    );
  });

  it("writes the Project-level example even when the retired per-agent location holds one", async () => {
    // A data root from before Benchmarks moved to the Project level keeps
    // agents/default_agent/benchmarks/example-benchmark/; nothing reads it, and it must not
    // stand in for the Project-level example.
    const legacy = path.join(
      agentStateDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      "benchmarks",
      EXAMPLE_BENCHMARK_ID,
    );
    await fs.mkdir(legacy, { recursive: true });
    await fs.writeFile(path.join(legacy, "benchmark_config.toml"), 'title = "old"\n');
    await provisionProjectBenchmarks(tmpRoot, DEFAULT_PROJECT_ID, []);
    const dir = benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID);
    expect(await exists(path.join(dir, EXAMPLE_BENCHMARK_ID, "benchmark_config.toml"))).toBe(true);
    // The legacy copy is left exactly as it was.
    expect(await fs.readFile(path.join(legacy, "benchmark_config.toml"), "utf8")).toBe(
      'title = "old"\n',
    );
  });

  it("loading default_agent writes no example: a deleted example stays deleted", async () => {
    await provisionProjectBenchmarks(tmpRoot, DEFAULT_PROJECT_ID, []);
    const example = path.join(benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID), EXAMPLE_BENCHMARK_ID);
    await fs.rm(example, { recursive: true, force: true });

    await loadAgentState({ init: {} });
    await loadAgentState();

    expect(await exists(example)).toBe(false);
  });

  it("creating a non-default agent writes no Benchmark", async () => {
    await loadAgentState({ init: {}, agentId: "worker" });
    expect(await exists(benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID))).toBe(false);
  });
});
