/**
 * Benchmark scoreboard read integration tests (read-only display): benchmark_config.toml title/description and runs
 * pass-through (falls back to directory name if missing), scoreboard.yaml v2's
 * evaluations[] (summary pass-through, per-case runs array; per-case metrics trust the
 * file values, falling back to an average over runs when missing), the legacy format
 * (per-case single session_id) parsed as a single run and backfilled, bad entries
 * discarded, case count, empty when unconfigured, permissions (members can read,
 * outsiders get 404).
 *
 * Tested with a plain Agent (no sample Benchmark pre-installed); default_agent's sample
 * Benchmark assertions live in builtin-agents.test.ts.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { benchmarksDir } from "@prismshadow/penguin-core";
import type { BenchmarksResponse, ProjectCreateResponse } from "../src/api/types.js";
import { apiClient, createTestApp, provisionUser } from "./helpers.js";
import type { TestApp } from "./helpers.js";

const AGENT = "bench_agent";

describe("benchmarks api", () => {
  let t: TestApp;
  let owner: ReturnType<typeof apiClient>;
  let member: ReturnType<typeof apiClient>;
  let outsider: ReturnType<typeof apiClient>;
  let projectId: string;
  let base: string;

  beforeEach(async () => {
    t = await createTestApp();
    const a = await provisionUser(t.app, "owner_a");
    const b = await provisionUser(t.app, "member_b");
    const c = await provisionUser(t.app, "outsider_c");
    owner = apiClient(t.app, a.cookie);
    member = apiClient(t.app, b.cookie);
    outsider = apiClient(t.app, c.cookie);
    const created = (await (
      await owner.post("/api/projects", { projectId: "owner_a-bench", name: "Bench project" })
    ).json()) as ProjectCreateResponse;
    projectId = created.project.projectId;
    // A plain Agent has no sample Benchmark pre-installed (only default_agent provides one).
    expect((await owner.post(`/api/projects/${projectId}/agents`, { agentId: AGENT })).status).toBe(
      201,
    );
    base = `/api/projects/${projectId}/agents/${AGENT}/benchmarks`;
    expect(
      (await owner.post(`/api/projects/${projectId}/members`, { userId: "member_b" })).status,
    ).toBe(201);
  });
  afterEach(async () => {
    await t.cleanup();
  });

  it("returns an empty list when unconfigured", async () => {
    expect((await (await owner.get(base)).json()) as BenchmarksResponse).toEqual({
      benchmarks: [],
    });
  });

  it("scoreboard v2: summary/runs pass through; metrics trust file or average runs", async () => {
    const dir = path.join(benchmarksDir(t.root, projectId, AGENT), "swe-bench-v2");
    await fs.mkdir(path.join(dir, "CASE-001-excel-task", "statement"), { recursive: true });
    await fs.mkdir(path.join(dir, "CASE-002-web-task", "rubric"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "benchmark_config.toml"),
      `title = "SWE Bench v2"\ndescription = "Example"\nruns = 2\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "scoreboard.yaml"),
      [
        "evaluations:",
        '  - time: "2026-07-16T10:00:00Z"',
        "    version: 3",
        '    provider: "deepseek"',
        '    model_id: "deepseek-v4-pro"',
        '    summary_title: "Added planning steps to the system Prompt"',
        '    summary: "Each case run twice and averaged; added planning steps."',
        "    score: 8.0",
        "    cost: 0.05",
        "    duration_ms: 120000",
        "    cases:",
        // Per-case metrics are all present: trust the file values (no recomputation even if inconsistent with the runs average).
        '      - case: "CASE-001-excel-task"',
        "        score: 4.2",
        "        cost: 0.02",
        "        duration_ms: 50000",
        "        runs:",
        "          - score: 4.0",
        "            cost: 0.018",
        "            duration_ms: 48000",
        '            session_id: "session-run-1"',
        "          - score: 4.5",
        "            cost: 0.022",
        "            duration_ms: 52000",
        '            session_id: "session-run-2"',
        // Per-case metrics are missing: computed as the average over runs.
        '      - case: "CASE-002-web-task"',
        "        runs:",
        "          - score: 3.0",
        "            cost: 0.01",
        "            duration_ms: 30000",
        '            session_id: "session-run-3"',
        "          - score: 4.0",
        "            cost: 0.03",
        "            duration_ms: 40000",
        '            session_id: "session-run-4"',
      ].join("\n"),
      "utf8",
    );

    const res = (await (await member.get(base)).json()) as BenchmarksResponse;
    const bench = res.benchmarks[0]!;
    expect(bench).toMatchObject({
      id: "swe-bench-v2",
      title: "SWE Bench v2",
      description: "Example",
      runs: 2,
      caseCount: 2,
    });
    // config carries no model reference (the model lives on each evaluation).
    expect("modelId" in bench).toBe(false);
    expect("provider" in bench).toBe(false);
    const evaluation = bench.evaluations[0]!;
    // The evaluation entry carries this run's model (as a pair) and a summary title (curve series / title-body are displayed separately).
    expect(evaluation.provider).toBe("deepseek");
    expect(evaluation.modelId).toBe("deepseek-v4-pro");
    expect(evaluation.summaryTitle).toBe("Added planning steps to the system Prompt");
    expect(evaluation.summary).toBe("Each case run twice and averaged; added planning steps.");
    expect(evaluation.score).toBe(8.0);
    // Per-case metrics are all present: trust the file (4.2, not the runs average of 4.25).
    const full = evaluation.cases.find((c) => c.case === "CASE-001-excel-task")!;
    expect(full.score).toBe(4.2);
    expect(full.cost).toBe(0.02);
    expect(full.durationMs).toBe(50000);
    expect(full.runs).toEqual([
      { score: 4.0, cost: 0.018, durationMs: 48000, sessionId: "session-run-1" },
      { score: 4.5, cost: 0.022, durationMs: 52000, sessionId: "session-run-2" },
    ]);
    // Per-case metrics are missing: computed as the average over runs.
    const derived = evaluation.cases.find((c) => c.case === "CASE-002-web-task")!;
    expect(derived.score).toBe(3.5);
    expect(derived.cost).toBeCloseTo(0.02, 10);
    expect(derived.durationMs).toBe(35000);
    expect(derived.runs).toHaveLength(2);
    expect(derived.sessionId).toBeUndefined();
  });

  it("legacy per-case session_id parsed as one backfilled run; bad entries dropped", async () => {
    const dir = path.join(benchmarksDir(t.root, projectId, AGENT), "swe-bench-v1");
    await fs.mkdir(path.join(dir, "CASE-001-excel-task", "statement"), { recursive: true });
    await fs.writeFile(path.join(dir, "benchmark_config.toml"), `title = "SWE Bench v1"\n`, "utf8");
    await fs.writeFile(
      path.join(dir, "scoreboard.yaml"),
      [
        "evaluations:",
        '  - time: "2026-07-16T10:00:00Z"',
        "    version: 1",
        "    score: 62.5",
        "    cost: 1.25",
        "    duration_ms: 60000",
        "    cases:",
        '      - case: "CASE-001-excel-task"',
        "        score: 30",
        "        cost: 0.5",
        "        duration_ms: 20000",
        '        session_id: "session-abc"',
        '      - case: ""', // Bad entry: discarded
        "        score: 1",
        "  - time: 42", // Bad evaluation: discarded
        "    score: 1",
      ].join("\n"),
      "utf8",
    );
    // A benchmark with no config file: title falls back to the directory name, config runs field is absent by default.
    await fs.mkdir(path.join(benchmarksDir(t.root, projectId, AGENT), "empty-bench"), {
      recursive: true,
    });

    const res = (await (await member.get(base)).json()) as BenchmarksResponse;
    expect(res.benchmarks.map((b) => b.id)).toEqual(["empty-bench", "swe-bench-v1"]);
    const bench = res.benchmarks[1]!;
    expect(bench).toMatchObject({ title: "SWE Bench v1", caseCount: 1 });
    expect("runs" in bench).toBe(false);
    expect(bench.evaluations).toHaveLength(1);
    expect(bench.evaluations[0]).toMatchObject({
      time: "2026-07-16T10:00:00Z",
      version: 1,
      score: 62.5,
      cost: 1.25,
      durationMs: 60000,
    });
    expect("summary" in bench.evaluations[0]!).toBe(false);
    // Legacy per-case format: fields unchanged, plus one backfilled run matching the case-level values (the frontend uniformly expands via runs).
    expect(bench.evaluations[0]?.cases).toEqual([
      {
        case: "CASE-001-excel-task",
        score: 30,
        cost: 0.5,
        durationMs: 20000,
        sessionId: "session-abc",
        runs: [{ score: 30, cost: 0.5, durationMs: 20000, sessionId: "session-abc" }],
      },
    ]);
    expect(res.benchmarks[0]).toMatchObject({
      title: "empty-bench",
      caseCount: 0,
      evaluations: [],
    });

    expect((await outsider.get(base)).status).toBe(404);
  });
});
