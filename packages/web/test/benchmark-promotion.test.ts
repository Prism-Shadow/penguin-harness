import { describe, expect, it } from "vitest";
import type { BenchmarkEvaluation, BenchmarkSummary } from "@prismshadow/penguin-server/api";
import {
  benchmarkPromotionState,
  evaluationWorkflowStatus,
} from "../src/features/benchmark/benchmark-promotion";
import { en } from "../src/lib/strings-en";
import { zh } from "../src/lib/strings";

const evaluation = (overrides: Partial<BenchmarkEvaluation>): BenchmarkEvaluation => ({
  time: "2026-08-11T00:00:00Z",
  provider: "openai",
  modelId: "gpt-test",
  thinkingLevel: "medium",
  version: 1,
  score: 50,
  cost: null,
  durationMs: 1,
  cases: [],
  ...overrides,
});

const benchmark = (overrides: Partial<BenchmarkSummary>): BenchmarkSummary => ({
  id: "development",
  title: "Development",
  role: "development",
  pairedBenchmarkId: "promotion",
  caseCount: 1,
  evaluations: [],
  ...overrides,
});

describe("benchmarkPromotionState", () => {
  it("finds a pending Candidate and keeps the held-out runtime", () => {
    const development = benchmark({
      evaluations: [
        evaluation({ evaluationKind: "formal_baseline" }),
        evaluation({
          version: 2,
          evaluationKind: "development_candidate",
          optimizationSessionId: "optimizer-1",
          productionReferenceVersion: 1,
        }),
      ],
    });
    const promotion = benchmark({
      id: "promotion",
      title: "Promotion",
      role: "promotion",
      pairedBenchmarkId: "development",
      evaluations: [evaluation({ evaluationKind: "formal_baseline" })],
    });
    expect(benchmarkPromotionState(development, [development, promotion], 2)).toEqual({
      productionVersion: 1,
      pending: {
        optimizationSessionId: "optimizer-1",
        candidateVersion: 2,
        productionReferenceVersion: 1,
        promotionBenchmarkId: "promotion",
        provider: "openai",
        modelId: "gpt-test",
        thinkingLevel: "medium",
      },
      run: null,
    });
  });

  it("clears pending after a decision and advances or restores production", () => {
    const development = benchmark({
      evaluations: [
        evaluation({
          version: 2,
          evaluationKind: "development_candidate",
          optimizationSessionId: "optimizer-1",
          productionReferenceVersion: 1,
        }),
      ],
    });
    const promoted = benchmark({
      id: "promotion",
      role: "promotion",
      pairedBenchmarkId: "development",
      evaluations: [
        evaluation({ evaluationKind: "formal_baseline" }),
        evaluation({
          version: 2,
          evaluationKind: "promotion_candidate",
          optimizationSessionId: "optimizer-1",
          productionReferenceVersion: 1,
          promotionDecision: "promoted",
        }),
      ],
    });
    expect(benchmarkPromotionState(development, [development, promoted], 2)).toEqual({
      productionVersion: 2,
      pending: null,
      run: null,
    });
    promoted.evaluations[1]!.promotionDecision = "restored";
    expect(benchmarkPromotionState(development, [development, promoted], 1)).toEqual({
      productionVersion: 1,
      pending: null,
      run: null,
    });
  });

  it("does not infer workflow state from names or summaries", () => {
    const general = benchmark({ role: "general", title: "Development", evaluations: [] });
    expect(benchmarkPromotionState(general, [general], 1)).toEqual({
      productionVersion: null,
      pending: null,
      run: null,
    });
  });
});

describe("evaluationWorkflowStatus", () => {
  it("maps structured kinds and decisions", () => {
    expect(evaluationWorkflowStatus({ evaluationKind: "formal_baseline" })).toBe("baseline");
    expect(evaluationWorkflowStatus({ evaluationKind: "development_candidate" })).toBe(
      "development",
    );
    expect(
      evaluationWorkflowStatus({
        evaluationKind: "promotion_candidate",
        promotionDecision: "promoted",
      }),
    ).toBe("promoted");
    expect(evaluationWorkflowStatus({})).toBe("evaluation");
  });
});

describe("optimization example", () => {
  it.each([zh, en])("commits an automatic request instead of asking for a third prompt", (copy) => {
    const prompt = copy.chat.exampleTasks.agentOptimization.prompt;
    expect(prompt).toContain("promotion_requests/<optimization_session_id>.yaml");
    expect(prompt).toContain("Development Benchmark");
    expect(prompt).not.toContain("heldout-promotion");
  });
});
