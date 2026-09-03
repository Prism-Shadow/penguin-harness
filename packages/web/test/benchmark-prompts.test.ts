/**
 * The Evaluation Center's prompts and id helpers (src/features/benchmark/benchmark-prompts.ts):
 * the New Benchmark tail hands the benchmark-design Skill its Test Agent and layout, the
 * Optimize tail carries every input the agent-optimization Skill requires, and the manual
 * form's directory names follow the id alphabet.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_RUNS,
  benchmarkCreateExamples,
  benchmarkCreateTail,
  benchmarkPath,
  buildOptimizePrompt,
  caseId,
  isValidRuns,
  optimizeExamples,
  optimizeTail,
  slugFromTitle,
} from "../src/features/benchmark/benchmark-prompts";

describe("benchmarkCreateTail", () => {
  it("names the Skill, the Test Agent and the layout the Skill writes", () => {
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
  });

  it("puts the focus text before the tail, and sends the tail alone when the focus is blank", () => {
    expect(buildOptimizePrompt("Focus on citations.", params)).toBe(
      `Focus on citations.\n\n${optimizeTail(params)}`,
    );
    expect(buildOptimizePrompt("   ", params)).toBe(optimizeTail(params));
  });

  it("offers examples with unique keys and non-empty prompts", () => {
    const examples = optimizeExamples();
    expect(examples.length).toBeGreaterThanOrEqual(3);
    expect(new Set(examples.map((e) => e.key)).size).toBe(examples.length);
    for (const e of examples) expect(e.prompt.trim()).not.toBe("");
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

  it("benchmarkPath is the directory relative to the App Data Dir", () => {
    expect(benchmarkPath("report-writer", "v1")).toBe("agents/report-writer/benchmarks/v1");
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
