/**
 * Unit tests for the Evaluation center's Score-only chart helpers: Score extraction,
 * gap segmentation across runtime series, y-axis max, and runtime grouping.
 */
import { describe, expect, it } from "vitest";
import {
  lineSegments,
  metricMax,
  modelSeries,
  scoreValues,
  seriesValues,
} from "../src/features/benchmark/benchmark-metrics";

const evaluations = [{ score: 60 }, { score: 75.25 }, { score: 85.5 }];

describe("scoreValues", () => {
  it("extracts stored Scores and treats non-finite malformed input as a gap", () => {
    expect(scoreValues(evaluations)).toEqual([60, 75.25, 85.5]);
    expect(scoreValues([{ score: Number.NaN }, { score: Infinity }])).toEqual([null, null]);
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

describe("metricMax (y-axis upper bound)", () => {
  it("takes the maximum of present points (ignoring null)", () => {
    expect(metricMax([0.12, null, 0.2])).toBe(0.2);
  });

  it("all missing / all zero yields a tiny positive number (no division by zero in the coordinate system)", () => {
    expect(metricMax([null, null])).toBe(1e-9);
    expect(metricMax([0, 0])).toBe(1e-9);
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
