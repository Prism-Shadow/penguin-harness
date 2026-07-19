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

describe("metricValues（按指标取值，缺失为 null）", () => {
  it("score 恒有", () => {
    expect(metricValues(evaluations, "score")).toEqual([6, 7.5, 8.5]);
  });

  it("cost / duration 缺失给 null（跳点）", () => {
    expect(metricValues(evaluations, "cost")).toEqual([0.12, null, 0.2]);
    expect(metricValues(evaluations, "duration")).toEqual([90_000, null, 60_000]);
  });

  it("非有限值（NaN / Infinity）按缺失对待", () => {
    expect(metricValues([{ score: 1, cost: Number.NaN }], "cost")).toEqual([null]);
    expect(metricValues([{ score: 1, durationMs: Infinity }], "duration")).toEqual([null]);
  });
});

describe("lineSegments（缺口切段）", () => {
  it("无缺口：单段全量（下标连续）", () => {
    expect(lineSegments([6, 7.5, 8.5])).toEqual([
      [
        { index: 0, value: 6 },
        { index: 1, value: 7.5 },
        { index: 2, value: 8.5 },
      ],
    ]);
  });

  it("中间缺口断开为两段（单点段照样成段：只画点不画线）", () => {
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

  it("全缺失 / 空列表：无段", () => {
    expect(lineSegments([null, null])).toEqual([]);
    expect(lineSegments([])).toEqual([]);
  });
});

describe("metricMax（纵轴上界）", () => {
  it("取有值点的最大值（忽略 null）", () => {
    expect(metricMax([0.12, null, 0.2])).toBe(0.2);
  });

  it("全缺失 / 全零给极小正数（坐标系不除零）", () => {
    expect(metricMax([null, null])).toBe(1e-9);
    expect(metricMax([0, 0])).toBe(1e-9);
  });
});

describe("modelSeries / seriesValues（曲线按模型分系列）", () => {
  const mixed = [
    { score: 6, provider: "deepseek", modelId: "deepseek-v4-flash" },
    { score: 7 }, // legacy record: no model tagged -> trailing gray series
    { score: 7.5, provider: "deepseek", modelId: "deepseek-v4-pro" },
    { score: 8.5, provider: "deepseek", modelId: "deepseek-v4-pro" },
  ];

  it("按 (provider, modelId) 分组，首次出现顺序排列，未标注归末尾无名系列", () => {
    const series = modelSeries(mixed);
    expect(series.map((s) => s.modelId)).toEqual([
      "deepseek-v4-flash",
      "deepseek-v4-pro",
      undefined,
    ]);
    expect(series.map((s) => s.indices)).toEqual([[0], [2, 3], [1]]);
    expect(series[2]!.key).toBe("");
  });

  it("同名 modelId 跨 provider 各成一系列（成对分组，不做拼接语义）", () => {
    const dup = [
      { score: 1, provider: "moonshot", modelId: "kimi-k2.6" },
      { score: 2, provider: "siliconflow", modelId: "kimi-k2.6" },
    ];
    const series = modelSeries(dup);
    expect(series).toHaveLength(2);
    expect(series.map((s) => s.provider)).toEqual(["moonshot", "siliconflow"]);
  });

  it("seriesValues：非本系列下标为 null（跳点），沿用全局时间轴", () => {
    const series = modelSeries(mixed);
    expect(seriesValues(mixed, series[1]!, "score")).toEqual([null, null, 7.5, 8.5]);
    expect(seriesValues(mixed, series[2]!, "score")).toEqual([null, 7, null, null]);
  });

  it("全部未标注：只有一条无名系列（旧数据单系列照画）", () => {
    const series = modelSeries([{}, {}]);
    expect(series).toHaveLength(1);
    expect(series[0]!.key).toBe("");
    expect(series[0]!.indices).toEqual([0, 1]);
  });
});
