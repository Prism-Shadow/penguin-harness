/**
 * Example Benchmark provisioning tests:
 * default_agent initialization pre-seeds benchmarks/example-benchmark/ (a parseable config,
 * runs=2, a scoreboard with three self-consistent evaluations); an ordinary Agent gets none;
 * provisioning is skipped idempotently when benchmarks/ already exists.
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
  benchmarksDir,
  buildExampleScoreboard,
  loadOrInitAgentState,
  provisionProjectAgents,
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
  cost: number;
  duration_ms: number;
  session_id: string;
}
interface CaseScore extends Omit<RunScore, "session_id"> {
  case: string;
  runs: RunScore[];
}
interface Evaluation extends Omit<CaseScore, "case" | "runs"> {
  time: string;
  version: number;
  provider: string;
  model_id: string;
  summary_title: string;
  summary: string;
  cases: CaseScore[];
}

describe("example benchmark provisioning", () => {
  it("default_agent init creates a parseable example benchmark (config + scoreboard + cases)", async () => {
    await loadOrInitAgentState();
    const dir = path.join(
      benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID),
      EXAMPLE_BENCHMARK_ID,
    );

    // benchmark_config.toml: title/description/runs=2; contains no model reference (the model
    // is recorded on each evaluation instead).
    const config = parseToml(await fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8"));
    expect(config.title).toBe("Example Benchmark");
    expect(String(config.description)).toContain("built-in example");
    expect(String(config.description)).toContain("Replace it with your own");
    expect(Number(config.runs)).toBe(2);
    expect(config).not.toHaveProperty("provider");
    expect(config).not.toHaveProperty("model_id");

    // Two cases: statement/ and rubric/ each use README.md as the index.
    for (const caseId of ["CASE-001-file-summary", "CASE-002-data-cleanup"]) {
      const statement = await fs.readFile(path.join(dir, caseId, "statement", "README.md"), "utf8");
      const rubric = await fs.readFile(path.join(dir, caseId, "rubric", "README.md"), "utf8");
      expect(statement.length).toBeGreaterThan(50);
      expect(rubric).toContain("pts");
    }

    // scoreboard.yaml: 3 evaluations, with version/time increasing and scores rising, and
    // 2 runs per case.
    const scoreboard = parseYaml(await fs.readFile(path.join(dir, "scoreboard.yaml"), "utf8")) as {
      evaluations: Evaluation[];
    };
    expect(scoreboard.evaluations).toHaveLength(3);
    expect(scoreboard.evaluations.map((e) => e.version)).toEqual([1, 2, 3]);
    const times = scoreboard.evaluations.map((e) => new Date(e.time).getTime());
    expect(times[0]!).toBeLessThan(times[1]!);
    expect(times[1]!).toBeLessThan(times[2]!);
    const scores = scoreboard.evaluations.map((e) => e.score);
    expect(scores[0]!).toBeLessThan(scores[1]!);
    expect(scores[1]!).toBeLessThan(scores[2]!);
    // Each evaluation carries the actual model used for that run (as a pair) and a summary
    // title; the example consistently uses deepseek-v4-pro.
    expect(scoreboard.evaluations.map((e) => e.model_id)).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-pro",
      "deepseek-v4-pro",
    ]);
    for (const e of scoreboard.evaluations) {
      expect(e.provider).toBe("deepseek");
      expect(e.summary_title.length).toBeGreaterThan(0);
      expect(e.summary.toLowerCase()).toContain("example");
      expect(e.cases).toHaveLength(2);
      for (const c of e.cases) {
        expect(c.runs).toHaveLength(2);
        for (const r of c.runs) {
          expect(r.session_id).toMatch(/^session-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}-\d{2}-[0-9a-f]{8}$/);
        }
      }
    }
  });

  it("scoreboard numbers are self-consistent (case = avg of runs, evaluation = sum of cases)", async () => {
    const { evaluations } = buildExampleScoreboard();
    const avg = (vals: number[]): number => vals.reduce((a, b) => a + b, 0) / vals.length;
    const sum = (vals: number[]): number => vals.reduce((a, b) => a + b, 0);
    for (const e of evaluations) {
      for (const c of e.cases) {
        expect(c.score).toBeCloseTo(avg(c.runs.map((r) => r.score)), 6);
        expect(c.cost).toBeCloseTo(avg(c.runs.map((r) => r.cost)), 6);
        expect(c.duration_ms).toBeCloseTo(avg(c.runs.map((r) => r.duration_ms)), 6);
      }
      expect(e.score).toBeCloseTo(sum(e.cases.map((c) => c.score)), 6);
      expect(e.cost).toBeCloseTo(sum(e.cases.map((c) => c.cost)), 6);
      expect(e.duration_ms).toBeCloseTo(sum(e.cases.map((c) => c.duration_ms)), 6);
    }
  });

  it("provisionProjectAgents also seeds the example benchmark for default_agent", async () => {
    await provisionProjectAgents({ root: tmpRoot, projectId: "proj_x" });
    expect(
      await exists(
        path.join(benchmarksDir(tmpRoot, "proj_x", DEFAULT_AGENT_ID), EXAMPLE_BENCHMARK_ID),
      ),
    ).toBe(true);
  });

  it("does not create benchmarks for a non-default agent", async () => {
    await loadOrInitAgentState({ agentId: "worker" });
    expect(await exists(benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID, "worker"))).toBe(false);
  });

  it("skips provisioning when benchmarks/ already exists (idempotent, no clobber)", async () => {
    const dir = benchmarksDir(tmpRoot, DEFAULT_PROJECT_ID, DEFAULT_AGENT_ID);
    await fs.mkdir(dir, { recursive: true });
    await loadOrInitAgentState();
    expect(await fs.readdir(dir)).toEqual([]);
  });
});
