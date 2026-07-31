/**
 * Unit tests for the Evaluation center's Score-only chart helpers: Score extraction,
 * dynamic y-axis range, gap segmentation across runtime series, and runtime grouping.
 */
import { describe, expect, it } from "vitest";
import {
  lineSegments,
  modelSeries,
  scoreScale,
  scoreValues,
  seriesValues,
} from "../src/features/benchmark/benchmark-metrics";

const evaluations = [{ score: 60 }, { score: 75.25 }, { score: 85.5 }];

describe("scoreValues", () => {
  it("preserves authoritative stored Scores and treats only non-finite input as a gap", () => {
    expect(scoreValues(evaluations)).toEqual([60, 75.25, 85.5]);
    expect(
      scoreValues([{ score: Number.NaN }, { score: Infinity }, { score: -1 }, { score: 101 }]),
    ).toEqual([null, null, -1, 101]);
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

describe("lineSegments (gap segmentation)", () => {
  it("no gaps: one segment with everything (consecutive indexes)", () => {
    expect(lineSegments([60, 75.25, 85.5])).toEqual([
      [
        { index: 0, value: 60 },
        { index: 1, value: 75.25 },
        { index: 2, value: 85.5 },
      ],
    ]);
  });

  it("a middle gap breaks into two segments (a lone point still forms a segment: point drawn, no line)", () => {
    expect(lineSegments([0.12, null, 0.2])).toEqual([
      [{ index: 0, value: 0.12 }],
      [{ index: 2, value: 0.2 }],
    ]);
    expect(lineSegments([null, 1, 2, null, 3])).toEqual([
      [
        { index: 1, value: 1 },
        { index: 2, value: 2 },
      ],
      [{ index: 4, value: 3 }],
    ]);
  });

  it("all missing / empty list: no segments", () => {
    expect(lineSegments([null, null])).toEqual([]);
    expect(lineSegments([])).toEqual([]);
  });
});

describe("modelSeries / seriesValues (curves split by model ID and thinking level)", () => {
  const mixed = [
    {
      score: 6,
      provider: "deepseek",
      modelId: "deepseek-v4-flash",
      thinkingLevel: "medium",
    },
    { score: 7 }, // Defensive untagged input -> trailing gray series.
    {
      score: 7.5,
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "xhigh",
    },
    {
      score: 8.5,
      provider: "deepseek",
      modelId: "deepseek-v4-pro",
      thinkingLevel: "xhigh",
    },
  ];

  it("groups by (modelId, thinkingLevel) in first-appearance order; untagged records go to a trailing unnamed series", () => {
    const series = modelSeries(mixed);
    expect(series.map((s) => s.modelId)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      undefined,
    ]);
    expect(series.map((s) => s.thinkingLevel)).toEqual(["medium", "xhigh", undefined]);
    expect(series.map((s) => s.indices)).toEqual([[0], [2, 3], [1]]);
    expect(series[2]!.key).toBe("");
  });

  it("the same model ID and thinking level across providers stays in one series", () => {
    const sameRuntime = [
      {
        score: 1,
        provider: "moonshot",
        modelId: "kimi-k2.6",
        thinkingLevel: "medium",
      },
      {
        score: 2,
        provider: "siliconflow",
        modelId: "kimi-k2.6",
        thinkingLevel: "medium",
      },
    ];
    const series = modelSeries(sameRuntime);
    expect(series).toHaveLength(1);
    expect(series[0]!.indices).toEqual([0, 1]);
  });

  it("the same model ID at different thinking levels forms separate series", () => {
    const levels = [
      { score: 1, modelId: "deepseek-v4-pro", thinkingLevel: "medium" },
      { score: 2, modelId: "deepseek-v4-pro", thinkingLevel: "xhigh" },
    ];
    const series = modelSeries(levels);
    expect(series).toHaveLength(2);
    expect(series.map((s) => s.thinkingLevel)).toEqual(["medium", "xhigh"]);
  });

  it("seriesValues: indexes outside the series are null (skipped points), keeping the global time axis", () => {
    const series = modelSeries(mixed);
    expect(seriesValues(mixed, series[1]!)).toEqual([null, null, 7.5, 8.5]);
    expect(seriesValues(mixed, series[2]!)).toEqual([null, 7, null, null]);
  });

  it("all untagged defensive input forms one unnamed series", () => {
    const series = modelSeries([{}, {}]);
    expect(series).toHaveLength(1);
    expect(series[0]!.key).toBe("");
    expect(series[0]!.indices).toEqual([0, 1]);
  });
});
