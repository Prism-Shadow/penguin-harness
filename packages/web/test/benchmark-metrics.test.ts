/**
 * Unit tests for the Evaluation center's Score-only chart helpers: Score extraction,
 * dynamic y-axis range, and label grouping — the tested Agent, its Agent State version, the
 * model and the thinking level, which is also what a score change is measured within. The gap
 * segmentation these series are drawn with is shared chart geometry (chart-geom's lineSegments,
 * covered in usage-charts.test.ts).
 */
import { describe, expect, it } from "vitest";
import {
  defaultTargetScore,
  evaluationLabel,
  labelSeries,
  latestScoreOfAgent,
  latestWithDelta,
  matchesBenchmarkQuery,
  scoreScale,
  scoreValues,
  seriesValues,
  sparklineSeries,
} from "../src/features/benchmark/benchmark-metrics";

const evaluations = [{ score: 60 }, { score: 75.25 }, { score: 85.5 }];

describe("scoreValues", () => {
  it("extracts stored Scores and treats non-finite input as a gap", () => {
    expect(scoreValues(evaluations)).toEqual([60, 75.25, 85.5]);
    expect(scoreValues([{ score: Number.NaN }, { score: Infinity }])).toEqual([null, null]);
  });
});

describe("scoreScale (dynamic padded Score axis)", () => {
  it("pads observed scores, clamps to 0..100, and rounds outward to friendly ticks", () => {
    expect(scoreScale([71, 83.67, 88.33])).toEqual({
      min: 60,
      max: 100,
      ticks: [60, 70, 80, 90, 100],
    });
  });

  it("keeps a dynamic range for a single or repeated score", () => {
    expect(scoreScale([88])).toEqual({
      min: 75,
      max: 100,
      ticks: [75, 80, 85, 90, 95, 100],
    });
    expect(scoreScale([50, 50])).toEqual({
      min: 40,
      max: 60,
      ticks: [40, 45, 50, 55, 60],
    });
  });

  it("clamps boundary scores and falls back safely when every value is missing", () => {
    expect(scoreScale([100])).toEqual({
      min: 90,
      max: 100,
      ticks: [90, 92, 94, 96, 98, 100],
    });
    expect(scoreScale([0])).toEqual({
      min: 0,
      max: 10,
      ticks: [0, 2, 4, 6, 8, 10],
    });
    expect(scoreScale([null, null])).toEqual({
      min: 0,
      max: 100,
      ticks: [0, 20, 40, 60, 80, 100],
    });
  });
});

describe("evaluationLabel", () => {
  const full = {
    agentId: "report-writer",
    version: 3,
    provider: "deepseek",
    modelId: "deepseek-v4-pro",
    thinkingLevel: "xhigh",
  };

  it("spells the four parts a reader sees and leaves the provider out of the text", () => {
    const label = evaluationLabel(full);
    expect(label.text).toBe("report-writer · v3 · deepseek-v4-pro · xhigh");
    expect(label.unlabeled).toBe(false);
    expect(label.key).not.toBe("");
  });

  it("omits an empty part from the text", () => {
    expect(evaluationLabel({ ...full, thinkingLevel: "" }).text).toBe(
      "report-writer · v3 · deepseek-v4-pro",
    );
  });

  it("keeps the provider in the key: the same model id at two providers is not one runtime", () => {
    expect(evaluationLabel({ ...full, provider: "siliconflow" }).key).not.toBe(
      evaluationLabel(full).key,
    );
    expect(evaluationLabel({ ...full, provider: "siliconflow" }).text).toBe(
      evaluationLabel(full).text,
    );
  });

  it("separates Agent State versions and tested Agents", () => {
    expect(evaluationLabel({ ...full, version: 4 }).key).not.toBe(evaluationLabel(full).key);
    expect(evaluationLabel({ ...full, agentId: "support" }).key).not.toBe(
      evaluationLabel(full).key,
    );
  });

  it("a record missing the tested Agent or the model is unlabeled", () => {
    expect(evaluationLabel({ ...full, agentId: null })).toEqual({
      key: "",
      text: "",
      unlabeled: true,
    });
    expect(evaluationLabel({ ...full, modelId: "" }).unlabeled).toBe(true);
    expect(evaluationLabel({}).unlabeled).toBe(true);
  });
});

describe("labelSeries / seriesValues (curves split by label)", () => {
  const mixed = [
    {
      score: 6,
      agentId: "report-writer",
      version: 1,
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      thinkingLevel: "medium",
    },
    { score: 7 }, // Defensive untagged input -> trailing gray series.
    {
      score: 7.5,
      agentId: "report-writer",
      version: 2,
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "xhigh",
    },
    {
      score: 8.5,
      agentId: "report-writer",
      version: 2,
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "xhigh",
    },
  ];

  it("groups by label in first-appearance order; unlabeled records go to a trailing series", () => {
    const series = labelSeries(mixed);
    expect(series.map((x) => x.text)).toEqual([
      "report-writer · v1 · deepseek-v4-flash · medium",
      "report-writer · v2 · deepseek-v4-pro · xhigh",
      "",
    ]);
    expect(series.map((x) => x.indices)).toEqual([[0], [2, 3], [1]]);
    expect(series.map((x) => x.unlabeled)).toEqual([false, false, true]);
    expect(series[2]!.key).toBe("");
  });

  it("the same runtime under two tested Agents forms separate series", () => {
    const series = labelSeries([
      { agentId: "report-writer", version: 1, modelId: "kimi-k2.6" },
      { agentId: "support", version: 1, modelId: "kimi-k2.6" },
    ]);
    expect(series).toHaveLength(2);
    expect(series.map((x) => x.indices)).toEqual([[0], [1]]);
  });

  it("seriesValues: indexes outside the series are null (skipped points), keeping the global time axis", () => {
    const series = labelSeries(mixed);
    expect(seriesValues(mixed, series[1]!)).toEqual([null, null, 7.5, 8.5]);
    expect(seriesValues(mixed, series[2]!)).toEqual([null, 7, null, null]);
  });

  it("all untagged defensive input forms one unnamed series", () => {
    const series = labelSeries([{}, {}]);
    expect(series).toHaveLength(1);
    expect(series[0]!.key).toBe("");
    expect(series[0]!.indices).toEqual([0, 1]);
  });
});

describe("row helpers: latestWithDelta / latestScoreOfAgent / sparklineSeries / defaultTargetScore", () => {
  const label = { agentId: "report-writer", version: 1, provider: "deepseek", modelId: "m" };
  const timed = [
    { time: "2026-07-14T09:30:00Z", score: 60, ...label },
    { time: "2026-07-15T09:30:00Z", score: Number.NaN, ...label },
    { time: "2026-07-16T09:30:00Z", score: 72.35, ...label },
  ];

  it("latestWithDelta reports the newest finite Score, its change from the previous finite one of the same label, and its time", () => {
    expect(latestWithDelta(timed)).toEqual({
      score: 72.35,
      delta: 72.35 - 60,
      time: timed[2]!.time,
    });
    expect(latestWithDelta([timed[0]!])).toEqual({ score: 60, delta: null, time: timed[0]!.time });
    expect(latestWithDelta([])).toBeNull();
    expect(latestWithDelta([timed[1]!])).toBeNull();
  });

  it("a newest record whose label appears for the first time reports no change", () => {
    const switched = [timed[0]!, { ...timed[2]!, version: 2 }];
    expect(latestWithDelta(switched)!.delta).toBeNull();
    // The label from two records back is the one it is comparable to.
    const back = [timed[0]!, { ...timed[2]!, agentId: "support" }, timed[2]!];
    expect(latestWithDelta(back)!.delta).toBe(72.35 - 60);
  });

  it("latestScoreOfAgent narrows to one tested Agent, and reports nothing when it has no score here", () => {
    const twoAgents = [timed[0]!, { ...timed[2]!, agentId: "support", score: 90 }];
    expect(latestScoreOfAgent(twoAgents, "report-writer")).toEqual({
      score: 60,
      delta: null,
      time: timed[0]!.time,
    });
    expect(latestScoreOfAgent(twoAgents, "support")!.score).toBe(90);
    expect(latestScoreOfAgent(twoAgents, "reviewer")).toBeNull();
    expect(latestScoreOfAgent(twoAgents, "")).toBeNull();
  });

  it("sparklineSeries keeps finite Scores in scoreboard order and skips malformed ones", () => {
    expect(sparklineSeries(timed)).toEqual([60, 72.35]);
    expect(sparklineSeries([])).toEqual([]);
  });

  it("defaultTargetScore is ten above the baseline as a whole number, capped at 100, and 80 without one", () => {
    expect(defaultTargetScore(72.35)).toBe(83);
    expect(defaultTargetScore(95)).toBe(100);
    expect(defaultTargetScore(null)).toBe(80);
  });
});

describe("matchesBenchmarkQuery", () => {
  const benchmark = {
    id: "report-writing-v1",
    title: "Report writing",
    description: "Hard cases",
    agentIds: ["report-writer", "support"],
  };
  const agents = [
    { agentId: "report-writer", name: "Report Writer" },
    { agentId: "support", name: "Support" },
    { agentId: "reviewer", name: "Reviewer" },
  ];

  it("matches case-insensitively on the title, description, id, and any tested agent's name or id", () => {
    expect(matchesBenchmarkQuery(benchmark, agents, "WRITING")).toBe(true);
    expect(matchesBenchmarkQuery(benchmark, agents, "hard")).toBe(true);
    expect(matchesBenchmarkQuery(benchmark, agents, "-v1")).toBe(true);
    expect(matchesBenchmarkQuery(benchmark, agents, "report writer")).toBe(true);
    expect(matchesBenchmarkQuery(benchmark, agents, "support")).toBe(true);
    // An agent that never ran this Benchmark is not a match, even though the Project has it.
    expect(matchesBenchmarkQuery(benchmark, agents, "reviewer")).toBe(false);
  });

  it("an id evaluated by a since-deleted agent still matches on the id itself", () => {
    expect(matchesBenchmarkQuery({ ...benchmark, agentIds: ["gone-agent"] }, agents, "gone")).toBe(
      true,
    );
  });

  it("a blank query matches everything", () => {
    expect(matchesBenchmarkQuery({ id: "x", title: "x" }, agents, "   ")).toBe(true);
  });
});
