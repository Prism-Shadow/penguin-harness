/**
 * Benchmark API integration tests: benchmark_config.toml title/description and runs
 * pass-through (and a directory without one is not listed), scoreboard.yaml v2's
 * evaluations[] (summary pass-through, model-written Case/Evaluation averages and per-case
 * runs arrays), rejection of legacy Scoreboard entries, case count, empty when
 * unconfigured, permissions (members can read, outsiders get 404), and the owner-only
 * create (the on-disk layout the Skills read) and delete routes.
 *
 * Tested with a plain Agent (no sample Benchmark pre-installed); default_agent's sample
 * Benchmark assertions live in builtin-agents.test.ts.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseToml } from "smol-toml";
import { benchmarksDir } from "@prismshadow/penguin-core";
import type {
  BenchmarkCasesResponse,
  BenchmarkCreateRequest,
  BenchmarkCreateResponse,
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

  it("current scoreboard: model-written averages, runtime, and runs pass through", async () => {
    const dir = path.join(benchmarksDir(t.root, projectId, AGENT), "swe-bench-v2");
    await fs.mkdir(path.join(dir, "CASE-001-excel-task", "statement"), { recursive: true });
    await fs.mkdir(path.join(dir, "CASE-001-excel-task", "statement", "assets"), {
      recursive: true,
    });
    await fs.mkdir(path.join(dir, "CASE-001-excel-task", "rubric"), { recursive: true });
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
      path.join(dir, "CASE-001-excel-task", "rubric", "README.md"),
      "# Scoring rubric\n\n- Correct workbook: 100 points",
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "CASE-001-excel-task", "rubric", "expected.json"),
      '{"rows": 1}\n',
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
        '    thinking_level: "medium"',
        '    summary_title: "Added planning steps to the system Prompt"',
        '    summary: "Each case run twice and averaged; added planning steps."',
        "    score: 72.35",
        "    cost: 0.04",
        "    duration_ms: 42500",
        "    cases:",
        // Stored averages are authoritative even when inconsistent with the raw Runs.
        '      - case: "CASE-001-excel-task"',
        "        score: 80.2",
        "        cost: 0.04",
        "        duration_ms: 50000",
        "        runs:",
        "          - score: 80",
        "            cost: null",
        "            duration_ms: 48000",
        '            session_id: "session-run-1"',
        "          - score: 82",
        "            cost: 0.04",
        "            duration_ms: 52000",
        '            session_id: "session-run-2"',
        // All unknown Run costs produce a model-written null Case cost; the Evaluation ignores it.
        '      - case: "CASE-002-web-task"',
        "        score: 64.5",
        "        cost: null",
        "        duration_ms: 35000",
        "        runs:",
        "          - score: 60",
        "            cost: null",
        "            duration_ms: 30000",
        '            session_id: "session-run-3"',
        "          - score: 70",
        "            cost: null",
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
    expect(evaluation.thinkingLevel).toBe("medium");
    expect(evaluation.summaryTitle).toBe("Added planning steps to the system Prompt");
    expect(evaluation.summary).toBe("Each case run twice and averaged; added planning steps.");
    expect(evaluation.score).toBe(72.35);
    expect(evaluation.cost).toBe(0.04);
    expect(evaluation.durationMs).toBe(42500);
    expect("maxScore" in evaluation).toBe(false);
    // Per-case metrics trust the file (80.2, not the Runs' arithmetic mean of 81).
    const full = evaluation.cases.find((c) => c.case === "CASE-001-excel-task")!;
    expect(full.score).toBe(80.2);
    expect(full.cost).toBe(0.04);
    expect(full.durationMs).toBe(50000);
    expect(full.runs).toEqual([
      { score: 80, cost: null, durationMs: 48000, sessionId: "session-run-1" },
      { score: 82, cost: 0.04, durationMs: 52000, sessionId: "session-run-2" },
    ]);
    const partialCost = evaluation.cases.find((c) => c.case === "CASE-002-web-task")!;
    expect(partialCost.score).toBe(64.5);
    expect(partialCost.cost).toBeNull();
    expect(partialCost.durationMs).toBe(35000);
    expect(partialCost.runs).toEqual([
      { score: 60, cost: null, durationMs: 30000, sessionId: "session-run-3" },
      { score: 70, cost: null, durationMs: 40000, sessionId: "session-run-4" },
    ]);

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

    const rubricFilesBase = `${base}/swe-bench-v2/cases/CASE-001-excel-task/rubric/files`;
    const rubricFiles = (await (
      await member.get(rubricFilesBase)
    ).json()) as WorkspaceFilesResponse;
    expect(rubricFiles.entries.map((entry) => `${entry.kind}:${entry.name}`)).toEqual([
      "file:expected.json",
      "file:README.md",
    ]);

    const rubric = await member.get(
      `${rubricFilesBase}/content?path=${encodeURIComponent("README.md")}&preview=1`,
    );
    expect(rubric.status).toBe(200);
    expect(rubric.headers.get("content-type")).toContain("markdown");
    expect(await rubric.text()).toContain("Correct workbook: 100 points");

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
    expect(
      (
        await member.get(
          `${rubricFilesBase}/content?path=${encodeURIComponent("../statement/README.md")}`,
        )
      ).status,
    ).toBe(400);
    expect((await outsider.get(`${base}/swe-bench-v2/cases`)).status).toBe(404);
    expect((await outsider.get(filesBase)).status).toBe(404);
  });

  it("does not migrate or backfill legacy Scoreboard entries", async () => {
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
    const res = (await (await member.get(base)).json()) as BenchmarksResponse;
    expect(res.benchmarks.map((b) => b.id)).toEqual(["swe-bench-v1"]);
    const bench = res.benchmarks[0]!;
    expect(bench).toMatchObject({ title: "SWE Bench v1", caseCount: 1 });
    expect("runs" in bench).toBe(false);
    expect(bench.evaluations).toEqual([]);

    expect((await outsider.get(base)).status).toBe(404);
  });

  it("lists a Benchmark that has never run, but not a directory without a config", async () => {
    const dir = benchmarksDir(t.root, projectId, AGENT);
    // Deleted mid-evaluation: the run kept writing, so the directory is back with a case and
    // a scoreboard but no config. Not a Benchmark — it must not reach the Evaluation Center.
    await fs.mkdir(path.join(dir, "half-deleted", "CASE-001-excel-task", "statement"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(dir, "half-deleted", "CASE-001-excel-task", "statement", "README.md"),
      "# Case 001: Excel cleanup\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(dir, "half-deleted", "scoreboard.yaml"),
      "evaluations: []\n",
      "utf8",
    );
    // Created and never evaluated: a config, cases, and no scoreboard at all. Still a
    // Benchmark — having no scores yet is not the same as being incomplete.
    await fs.mkdir(path.join(dir, "never-run", "CASE-001-report", "statement"), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(dir, "never-run", "benchmark_config.toml"),
      'title = "Report writing"\nruns = 2\n',
      "utf8",
    );

    const res = (await (await member.get(base)).json()) as BenchmarksResponse;
    expect(res.benchmarks.map((b) => b.id)).toEqual(["never-run"]);
    expect(res.benchmarks[0]).toMatchObject({
      title: "Report writing",
      runs: 2,
      caseCount: 1,
      evaluations: [],
    });
  });

  /** A well-formed create request; the tests below vary one field at a time. */
  const createBody: BenchmarkCreateRequest = {
    id: "report-writing-v1",
    title: "Report writing",
    description: "Hard cases for the report writer",
    runs: 2,
    cases: [
      {
        id: "CASE-001-contradictions",
        title: "Contradicting sources",
        statement: "Write a report from the two briefs in this Workspace.\n",
        rubric: "- 60 pts: names the contradiction.\n- 40 pts: picks the dated source.\n",
      },
      {
        id: "CASE-002-format",
        title: "Strict format",
        statement: "Follow the template exactly.",
        rubric: "- 100 pts: every template section present.",
      },
    ],
  };

  it("owner creates a Benchmark by hand and the server writes the Skill layout", async () => {
    const res = await owner.post(base, createBody);
    expect(res.status).toBe(201);
    const { benchmark } = (await res.json()) as BenchmarkCreateResponse;
    expect(benchmark).toEqual({
      id: "report-writing-v1",
      title: "Report writing",
      description: "Hard cases for the report writer",
      runs: 2,
      caseCount: 2,
      evaluations: [],
    });

    const dir = path.join(benchmarksDir(t.root, projectId, AGENT), "report-writing-v1");
    expect(parseToml(await fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8"))).toEqual({
      title: "Report writing",
      description: "Hard cases for the report writer",
      runs: 2,
    });
    expect(await fs.readFile(path.join(dir, "scoreboard.yaml"), "utf8")).toBe("evaluations: []\n");
    // The statement README opens with the title as its heading (what the case list reads
    // back); the rubric is written verbatim, trimmed to one trailing newline.
    expect(
      await fs.readFile(
        path.join(dir, "CASE-001-contradictions", "statement", "README.md"),
        "utf8",
      ),
    ).toBe("# Contradicting sources\n\nWrite a report from the two briefs in this Workspace.\n");
    expect(
      await fs.readFile(path.join(dir, "CASE-001-contradictions", "rubric", "README.md"), "utf8"),
    ).toBe("- 60 pts: names the contradiction.\n- 40 pts: picks the dated source.\n");

    const list = (await (await member.get(base)).json()) as BenchmarksResponse;
    expect(list.benchmarks.map((b) => b.id)).toEqual(["report-writing-v1"]);
    const cases = (await (
      await member.get(`${base}/report-writing-v1/cases`)
    ).json()) as BenchmarkCasesResponse;
    expect(cases.cases).toEqual([
      { id: "CASE-001-contradictions", title: "Contradicting sources" },
      { id: "CASE-002-format", title: "Strict format" },
    ]);

    // The same id again is a conflict, and the first Benchmark is left as it was.
    const again = await owner.post(base, { ...createBody, title: "Overwrite attempt" });
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe(
      "benchmark_exists",
    );
    expect(
      parseToml(await fs.readFile(path.join(dir, "benchmark_config.toml"), "utf8")),
    ).toMatchObject({ title: "Report writing" });
  });

  it("rejects malformed create requests and non-owners without writing anything", async () => {
    const first = createBody.cases[0]!;
    const bad: unknown[] = [
      { ...createBody, id: "../escape" },
      { ...createBody, id: "" },
      { ...createBody, title: "   " },
      { ...createBody, runs: 0 },
      { ...createBody, runs: 1.5 },
      { ...createBody, runs: 1001 },
      { ...createBody, cases: [] },
      { ...createBody, cases: [{ ...first, id: "excel-task" }] },
      { ...createBody, cases: [{ ...first, id: "CASE-001/../x" }] },
      { ...createBody, cases: [first, first] },
      { ...createBody, cases: [{ ...first, rubric: "" }] },
    ];
    for (const body of bad) {
      expect((await owner.post(base, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await member.post(base, createBody)).status).toBe(403);
    expect((await outsider.post(base, createBody)).status).toBe(404);
    // A missing Agent is a 404 before any validation.
    expect(
      (await owner.post(`/api/projects/${projectId}/agents/nobody/benchmarks`, createBody)).status,
    ).toBe(404);
    expect(((await (await owner.get(base)).json()) as BenchmarksResponse).benchmarks).toEqual([]);
  });

  it("owner deletes a Benchmark directory whole; members and outsiders cannot", async () => {
    expect((await owner.post(base, createBody)).status).toBe(201);
    const dir = path.join(benchmarksDir(t.root, projectId, AGENT), "report-writing-v1");
    expect((await member.delete(`${base}/report-writing-v1`)).status).toBe(403);
    expect((await outsider.delete(`${base}/report-writing-v1`)).status).toBe(404);
    await expect(fs.access(dir)).resolves.toBeUndefined();

    expect((await owner.delete(`${base}/report-writing-v1`)).status).toBe(204);
    await expect(fs.access(dir)).rejects.toThrow();
    expect(((await (await owner.get(base)).json()) as BenchmarksResponse).benchmarks).toEqual([]);
    // Gone, or never there: both are a plain 404.
    expect((await owner.delete(`${base}/report-writing-v1`)).status).toBe(404);
    expect((await owner.delete(`${base}/never-existed`)).status).toBe(404);
  });
});
