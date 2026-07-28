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
import type {
  BenchmarkCasesResponse,
  BenchmarksResponse,
  ProjectCreateResponse,
  WorkspaceFilesResponse,
} from "../src/api/types.js";
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
    await fs.mkdir(path.join(dir, "CASE-001-excel-task", "statement", "assets"), {
      recursive: true,
    });
    await fs.mkdir(path.join(dir, "CASE-002-web-task", "statement"), { recursive: true });
    await fs.mkdir(path.join(dir, "CASE-002-web-task", "rubric"), { recursive: true });
    await fs.writeFile(
      path.join(dir, "CASE-001-excel-task", "statement", "README.md"),
      "# Case 001: Excel cleanup\n\nClean the workbook.",
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "CASE-001-excel-task", "statement", "data.csv"),
      "id,value\n1,alpha\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "CASE-001-excel-task", "statement", "assets", "notes.txt"),
      "public notes",
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "CASE-001-excel-task", "statement", "large.txt"),
      "x".repeat(300 * 1024),
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "CASE-002-web-task", "statement", "README.md"),
      "# Web task\n\nBuild the page.",
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "CASE-002-web-task", "rubric", "README.md"),
      "PRIVATE GOLD: never return this text",
      "utf8",
    );
    await fs.symlink(
      path.join(dir, "CASE-002-web-task", "rubric", "README.md"),
      path.join(dir, "CASE-001-excel-task", "statement", "private-link.md"),
    );
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
        "        max_score: 5",
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
        "        max_score: 5",
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
    expect(evaluation.maxScore).toBe(10);
    // Per-case metrics are all present: trust the file (4.2, not the runs average of 4.25).
    const full = evaluation.cases.find((c) => c.case === "CASE-001-excel-task")!;
    expect(full.score).toBe(4.2);
    expect(full.maxScore).toBe(5);
    expect(full.cost).toBe(0.02);
    expect(full.durationMs).toBe(50000);
    expect(full.runs).toEqual([
      { score: 4.0, cost: 0.018, durationMs: 48000, sessionId: "session-run-1" },
      { score: 4.5, cost: 0.022, durationMs: 52000, sessionId: "session-run-2" },
    ]);
    // Per-case metrics are missing: computed as the average over runs.
    const derived = evaluation.cases.find((c) => c.case === "CASE-002-web-task")!;
    expect(derived.score).toBe(3.5);
    expect(derived.maxScore).toBe(5);
    expect(derived.cost).toBeCloseTo(0.02, 10);
    expect(derived.durationMs).toBe(35000);
    expect(derived.runs).toHaveLength(2);
    expect(derived.sessionId).toBeUndefined();

    const caseResponse = (await (
      await member.get(`${base}/swe-bench-v2/cases`)
    ).json()) as BenchmarkCasesResponse;
    expect(caseResponse).toEqual({
      cases: [
        {
          id: "CASE-001-excel-task",
          title: "Excel cleanup",
        },
        {
          id: "CASE-002-web-task",
          title: "Web task",
        },
      ],
    });
    expect(JSON.stringify(caseResponse)).not.toContain("PRIVATE GOLD");

    const filesBase = `${base}/swe-bench-v2/cases/CASE-001-excel-task/files`;
    const files = (await (await member.get(filesBase)).json()) as WorkspaceFilesResponse;
    expect(files.path).toBe("");
    expect(files.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      "dir:assets",
      "file:data.csv",
      "file:large.txt",
      "file:README.md",
    ]);
    expect(JSON.stringify(files)).not.toContain("private-link.md");
    expect(
      (
        await member.get(
          `${filesBase}/content?path=${encodeURIComponent("private-link.md")}&preview=1`,
        )
      ).status,
    ).toBe(400);

    const nested = (await (
      await member.get(`${filesBase}?path=${encodeURIComponent("assets")}`)
    ).json()) as WorkspaceFilesResponse;
    expect(nested.entries.map((entry) => entry.name)).toEqual(["notes.txt"]);

    const statement = await member.get(
      `${filesBase}/content?path=${encodeURIComponent("README.md")}&preview=1`,
    );
    expect(statement.status).toBe(200);
    expect(statement.headers.get("content-type")).toContain("markdown");
    expect(await statement.text()).toBe("# Case 001: Excel cleanup\n\nClean the workbook.");

    const large = await member.get(
      `${filesBase}/content?path=${encodeURIComponent("large.txt")}&preview=1`,
    );
    expect(large.status).toBe(200);
    expect(large.headers.get("x-content-truncated")).toBe("1");
    expect((await large.text()).length).toBe(256 * 1024);

    const download = await member.get(
      `${filesBase}/content?path=${encodeURIComponent("data.csv")}&download=1`,
    );
    expect(download.headers.get("content-disposition")).toContain("attachment");
    expect(await download.text()).toBe("id,value\n1,alpha\n");

    expect(
      (await member.get(`${filesBase}/content?path=${encodeURIComponent("../rubric/README.md")}`))
        .status,
    ).toBe(400);
    expect((await outsider.get(`${base}/swe-bench-v2/cases`)).status).toBe(404);
    expect((await outsider.get(filesBase)).status).toBe(404);
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
