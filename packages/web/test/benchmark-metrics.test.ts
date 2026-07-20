/**
 * Unit tests for benchmark-metrics.ts: metric switching on the evaluation-center
 * chart (score / cost / duration) — value extraction (missing -> null), gap
 * segmentation (skipped points: connect within a segment, break between
 * segments, a lone point still forms its own segment), and the y-axis max.
 */
import { describe, expect, it } from "vitest";
import {
  lineSegments,
  metricMax,
  metricValues,
  modelSeries,
  seriesValues,
} from "../src/features/benchmark/benchmark-metrics";

const evaluations = [
  { score: 6, cost: 0.12, durationMs: 90_000 },
  { score: 7.5 }, // legacy record: no cost / durationMs
  { score: 8.5, cost: 0.2, durationMs: 60_000 },
];

describe("metricValues (value extraction by metric, missing → null)", () => {
  it("score is always present", () => {
    expect(metricValues(evaluations, "score")).toEqual([6, 7.5, 8.5]);
  });

  it("missing cost / duration yields null (skipped point)", () => {
    expect(metricValues(evaluations, "cost")).toEqual([0.12, null, 0.2]);
    expect(metricValues(evaluations, "duration")).toEqual([90_000, null, 60_000]);
  });

  it("non-finite values (NaN / Infinity) are treated as missing", () => {
    expect(metricValues([{ score: 1, cost: Number.NaN }], "cost")).toEqual([null]);
    expect(metricValues([{ score: 1, durationMs: Infinity }], "duration")).toEqual([null]);
  });
});

describe("lineSegments (gap segmentation)", () => {
  it("no gaps: one segment with everything (consecutive indexes)", () => {
    expect(lineSegments([6, 7.5, 8.5])).toEqual([
      [
        { index: 0, value: 6 },
        { index: 1, value: 7.5 },
        { index: 2, value: 8.5 },
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

describe("modelSeries / seriesValues (curves split into series by model)", () => {
  const mixed = [
    { score: 6, provider: "deepseek", modelId: "deepseek-v4-flash" },
    { score: 7 }, // legacy record: no model tagged -> trailing gray series
    { score: 7.5, provider: "deepseek", modelId: "deepseek-v4-pro" },
    { score: 8.5, provider: "deepseek", modelId: "deepseek-v4-pro" },
  ];

  it("groups by (provider, modelId) in first-appearance order; untagged records go to a trailing unnamed series", () => {
    const series = modelSeries(mixed);
    expect(series.map((s) => s.modelId)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      undefined,
    ]);
    expect(series.map((s) => s.indices)).toEqual([[0], [2, 3], [1]]);
    expect(series[2]!.key).toBe("");
  });

  it("the same modelId across providers forms separate series (paired grouping, no concatenation semantics)", () => {
    const dup = [
      { score: 1, provider: "moonshot", modelId: "kimi-k2.6" },
      { score: 2, provider: "siliconflow", modelId: "kimi-k2.6" },
    ];
    const series = modelSeries(dup);
    expect(series).toHaveLength(2);
    expect(series.map((s) => s.provider)).toEqual(["moonshot", "siliconflow"]);
  });

  it("seriesValues: indexes outside the series are null (skipped points), keeping the global time axis", () => {
    const series = modelSeries(mixed);
    expect(seriesValues(mixed, series[1]!, "score")).toEqual([null, null, 7.5, 8.5]);
    expect(seriesValues(mixed, series[2]!, "score")).toEqual([null, 7, null, null]);
  });

  it("all untagged: just one unnamed series (legacy data still draws as a single series)", () => {
    const series = modelSeries([{}, {}]);
    expect(series).toHaveLength(1);
    expect(series[0]!.key).toBe("");
    expect(series[0]!.indices).toEqual([0, 1]);
  });
});
