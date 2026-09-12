/**
 * The Evaluation Center's prompts and id helpers (src/features/benchmark/benchmark-prompts.ts):
 * the Create-with-AI tail hands the benchmark-design Skill its tested Agent and the Project-level
 * layout, the Evaluate and Optimize tails carry every input the agent-evaluation and
 * agent-optimization Skills require, the two Ask AI tails carry the facts on screen and the
 * files they were read from, and the manual form's directory names follow the id alphabet.
 * Assertions on a tail's wording are language-agnostic: the ids, paths and Session ids it must
 * name, never the sentences around them, which differ per dictionary.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_RUNS,
  askCaseExamples,
  askCaseTail,
  askEvaluationExamples,
  askEvaluationTail,
  benchmarkCreateExamples,
  benchmarkCreateTail,
  benchmarkPath,
  buildEvaluatePrompt,
  buildOptimizePrompt,
  caseId,
  evaluateTail,
  isValidRuns,
  optimizeTail,
  slugFromTitle,
} from "../src/features/benchmark/benchmark-prompts";

describe("benchmarkCreateTail", () => {
  it("names the Skill, the tested Agent and the layout the Skill writes", () => {
    const tail = benchmarkCreateTail("report-writer");
    expect(tail).toContain("`benchmark-design`");
    expect(tail).toContain("`report-writer`");
    expect(tail).toContain("`agent-evaluation`");
    expect(tail).toContain("benchmark_config.toml");
    expect(tail).toContain("scoreboard.yaml");
    // Benchmark design calibrates with one run per case; the tail never asks for another count.
    expect(tail).toContain("runs = 1");
    expect(tail).toContain("pilot_iteration_limit");
  });

  it("places the Benchmark at the Project level and has every evaluation record its tested Agent", () => {
    const tail = benchmarkCreateTail("report-writer");
    expect(tail).toContain("`benchmarks/<benchmark_id>/`");
    expect(tail).not.toContain("agents/report-writer");
    expect(tail).toContain("`agent_id`");
  });

  it("offers examples with unique keys and non-empty prompts", () => {
    const examples = benchmarkCreateExamples();
    expect(examples.length).toBeGreaterThanOrEqual(4);
    expect(new Set(examples.map((e) => e.key)).size).toBe(examples.length);
    for (const e of examples) {
      expect(e.label).not.toBe("");
      expect(e.prompt.trim()).not.toBe("");
    }
  });
});

describe("evaluateTail / buildEvaluatePrompt", () => {
  const params = {
    targetAgentId: "report-writer",
    benchmarkId: "report-writing-v1",
    runs: 2,
  };

  it("carries every input the agent-evaluation Skill requires", () => {
    const tail = evaluateTail(params);
    expect(tail).toContain("`agent-evaluation`");
    expect(tail).toContain("`report-writer`");
    expect(tail).toContain("`report-writing-v1`");
    expect(tail).toMatch(/runs[：:] ?`2`/);
    // The Benchmark sits beside the agents, and the appended evaluation names the tested one
    // together with the rest of its label.
    expect(tail).toContain("`benchmarks/report-writing-v1/`");
    expect(tail).toContain("scoreboard.yaml");
    for (const field of ["`agent_id`", "`version`", "`provider`", "`model_id`", "`thinking_level`"])
      expect(tail).toContain(field);
  });

  it("asks for the full matrix through self-spawned subagents and a single appended record", () => {
    const tail = evaluateTail(params);
    expect(tail).toContain("run_subagent");
    expect(tail).toContain("Case × runs");
    // The tail must not offer an optimization: this request only measures.
    expect(tail).not.toContain("agent-optimization");
    expect(tail).not.toContain("desired_score");
  });

  it("puts the note before the tail, and sends the tail alone when the note is blank", () => {
    expect(buildEvaluatePrompt("Watch the citation cases.", params)).toBe(
      `Watch the citation cases.\n\n${evaluateTail(params)}`,
    );
    expect(buildEvaluatePrompt("   ", params)).toBe(evaluateTail(params));
  });
});

describe("optimizeTail / buildOptimizePrompt", () => {
  const params = {
    targetAgentId: "report-writer",
    benchmarkId: "report-writing-v1",
    runs: 2,
    roundLimit: 3,
    targetScore: 85,
  };

  it("carries every input the agent-optimization Skill requires", () => {
    const tail = optimizeTail(params);
    expect(tail).toContain("`agent-optimization`");
    expect(tail).toContain("`report-writer`");
    expect(tail).toContain("`report-writing-v1`");
    expect(tail).toMatch(/runs[：:] ?`2`/);
    expect(tail).toMatch(/desired_score[：:] ?`>=85`/);
    expect(tail).toMatch(/candidate_round_limit[：:] ?`3`/);
    expect(tail).toContain("scoreboard.yaml");
    // The Benchmark sits beside the agents, and the appended evaluation names the tested one.
    expect(tail).toContain("`benchmarks/report-writing-v1/`");
    expect(tail).toContain("`agent_id`");
  });

  it("puts the focus text before the tail, and sends the tail alone when the focus is blank", () => {
    expect(buildOptimizePrompt("Focus on citations.", params)).toBe(
      `Focus on citations.\n\n${optimizeTail(params)}`,
    );
    expect(buildOptimizePrompt("   ", params)).toBe(optimizeTail(params));
  });
});

describe("askEvaluationTail (the evaluation dialog's Ask AI question)", () => {
  const params = {
    benchmarkId: "report-writing-v1",
    time: "2026-07-16 09:30",
    label: "report-writer · deepseek-v4-pro · xhigh",
    version: 3,
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    thinkingLevel: "xhigh",
    score: "72.35",
    cost: "$0.42",
    duration: "3m20s",
    summaryTitle: "Citations still weak",
    summary: "Two cases lost points on citation format.",
    cases: [
      {
        id: "CASE-001-contradictions",
        score: "80",
        cost: "$0.21",
        duration: "1m40s",
        sessionIds: ["ses-a1", "ses-a2"],
      },
      {
        id: "CASE-002-citations",
        score: "64.7",
        cost: "$0.21",
        duration: "1m40s",
        sessionIds: ["ses-b1"],
      },
    ],
  };

  it("names the Benchmark, its scoreboard and the label facts of this record", () => {
    const tail = askEvaluationTail(params);
    expect(tail).toContain("`report-writing-v1`");
    expect(tail).toContain("`benchmarks/report-writing-v1/`");
    expect(tail).toContain("`benchmarks/report-writing-v1/scoreboard.yaml`");
    expect(tail).toContain("2026-07-16 09:30");
    expect(tail).toContain("report-writer · deepseek-v4-pro · xhigh");
    expect(tail).toContain("v3");
    expect(tail).toContain("`deepseek`");
    expect(tail).toContain("`deepseek-v4-pro`");
    expect(tail).toContain("`xhigh`");
    expect(tail).toContain("72.35");
    expect(tail).toContain("$0.42");
    expect(tail).toContain("3m20s");
    expect(tail).toContain("Citations still weak");
    expect(tail).toContain("Two cases lost points on citation format.");
  });

  it("lists every case with its score and the Session id of every run", () => {
    const tail = askEvaluationTail(params);
    for (const c of params.cases) {
      expect(tail).toContain(`\`${c.id}\``);
      expect(tail).toContain(c.score);
      for (const sessionId of c.sessionIds) expect(tail).toContain(`\`${sessionId}\``);
    }
  });

  it("omits a summary the record does not carry, and says so when no run recorded a Session", () => {
    const tail = askEvaluationTail({
      ...params,
      summaryTitle: "",
      summary: "",
      cases: [{ ...params.cases[0]!, sessionIds: [] }],
    });
    expect(tail).not.toContain("Citations still weak");
    expect(tail).not.toContain("Two cases lost points on citation format.");
    expect(tail).toContain("`CASE-001-contradictions`");
    expect(tail).not.toContain("ses-a1");
  });

  // It asks for an explanation of scores already recorded: no Skill to run, nothing to change.
  it("names no Skill and no subagent to spawn", () => {
    const tail = askEvaluationTail(params);
    expect(tail).not.toContain("agent-evaluation");
    expect(tail).not.toContain("agent-optimization");
    expect(tail).not.toContain("run_subagent");
  });

  it("offers examples with unique keys and non-empty prompts", () => {
    const examples = askEvaluationExamples();
    expect(examples).toHaveLength(3);
    expect(new Set(examples.map((e) => e.key)).size).toBe(examples.length);
    for (const e of examples) {
      expect(e.label).not.toBe("");
      expect(e.prompt.trim()).not.toBe("");
    }
  });
});

describe("askCaseTail (the case dialog's Ask AI question)", () => {
  const params = {
    benchmarkId: "report-writing-v1",
    caseId: "CASE-002-citations",
    latest: {
      time: "2026-07-16 09:30",
      score: "64.7",
      runs: [
        { score: "70", sessionId: "ses-b1" },
        { score: "59.4", sessionId: "ses-b2" },
      ],
    },
  };

  it("names both material paths and the latest evaluation's runs with their Sessions", () => {
    const tail = askCaseTail(params);
    expect(tail).toContain("`report-writing-v1`");
    expect(tail).toContain("`CASE-002-citations`");
    expect(tail).toContain("`benchmarks/report-writing-v1/CASE-002-citations/statement/README.md`");
    expect(tail).toContain("`benchmarks/report-writing-v1/CASE-002-citations/rubric/README.md`");
    expect(tail).toContain("2026-07-16 09:30");
    expect(tail).toContain("64.7");
    expect(tail).toContain("`ses-b1`");
    expect(tail).toContain("`ses-b2`");
  });

  it("keeps the paths and carries no run results when the Benchmark has no evaluations", () => {
    const tail = askCaseTail({ ...params, latest: null });
    expect(tail).toContain("`benchmarks/report-writing-v1/CASE-002-citations/statement/README.md`");
    expect(tail).toContain("`benchmarks/report-writing-v1/CASE-002-citations/rubric/README.md`");
    expect(tail).not.toContain("ses-b1");
    expect(tail).not.toContain("64.7");
  });

  it("offers examples with unique keys and non-empty prompts", () => {
    const examples = askCaseExamples();
    expect(examples).toHaveLength(3);
    expect(new Set(examples.map((e) => e.key)).size).toBe(examples.length);
    for (const e of examples) {
      expect(e.label).not.toBe("");
      expect(e.prompt.trim()).not.toBe("");
    }
  });
});

describe("id helpers", () => {
  it("slugFromTitle keeps ASCII words, folds separators, and yields nothing for a CJK title", () => {
    expect(slugFromTitle("Report Writing (hard) v1")).toBe("report-writing-hard-v1");
    expect(slugFromTitle("  报告写作  ")).toBe("");
    expect(slugFromTitle("--a__b--")).toBe("a-b");
  });

  it("caseId pads the position to three digits", () => {
    expect(caseId(1, "contradictions")).toBe("CASE-001-contradictions");
    expect(caseId(12, "x")).toBe("CASE-012-x");
  });

  it("benchmarkPath is the Project-level directory relative to the App Data Dir", () => {
    expect(benchmarkPath("v1")).toBe("benchmarks/v1");
  });

  // The create route enforces the same bound, so a Benchmark can never be created with a runs
  // count the Optimize dialog would then refuse.
  it("isValidRuns accepts 1..MAX_RUNS and nothing else", () => {
    expect(isValidRuns("1")).toBe(true);
    expect(isValidRuns(String(MAX_RUNS))).toBe(true);
    expect(isValidRuns(String(MAX_RUNS + 1))).toBe(false);
    expect(isValidRuns("0")).toBe(false);
    expect(isValidRuns("")).toBe(false);
    expect(isValidRuns("1.5")).toBe(false);
  });
});
