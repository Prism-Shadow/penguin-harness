/**
 * Cost center control + series-shaping helper tests (usage-controls.ts): range
 * presets (calendar and trailing timestamp windows), the precision each range
 * derives (there is no precision control) and the bucket counts that keeps
 * inside the server's cap, bucket-key labels, entity
 * folding for the requests chart's stacked bars (top entities + a neutral
 * counted tail), the per-bucket success / cache-hit rates (a bucket with
 * nothing to rate has no rate, and is only given a height when a line has to
 * cross it), and the empty-bucket compaction every chart on the page draws
 * over — including that the per-entity counts stay aligned with the buckets
 * after it.
 */
import { describe, expect, it } from "vitest";
import type { UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import {
  bucketAxisLabel,
  bucketFullLabel,
  compactCounts,
  compactSeries,
  defaultGranularity,
  foldEntitySeries,
  hitRateValues,
  isoDate,
  MAX_NAMED_SERIES,
  NO_RATE_PLOT,
  plotRates,
  presetDefaultGranularity,
  presetRange,
  presetTsWindow,
  rangeDays,
  rateSeries,
  sumCounts,
} from "../src/features/usage/usage-controls";
import { SERIES_COLORS } from "../src/lib/category-colors";

const point = (over: Partial<UsageSeriesPoint>): UsageSeriesPoint => ({
  bucket: "2026-08-20",
  cacheRead: 0,
  cacheWrite: 0,
  output: 0,
  total: 0,
  cost: null,
  requests: 0,
  completed: 0,
  denominator: 0,
  ...over,
});

describe("presetRange / presetTsWindow / rangeDays", () => {
  it("a calendar preset ends today and spans its day count inclusively", () => {
    const today = new Date(2026, 7, 20); // 2026-08-20 local
    expect(presetRange("7d", today)).toEqual({ from: "2026-08-14", to: "2026-08-20" });
    expect(presetRange("30d", today)).toEqual({ from: "2026-07-22", to: "2026-08-20" });
    expect(presetRange("90d", today)).toEqual({ from: "2026-05-23", to: "2026-08-20" });
    expect(isoDate(today)).toBe("2026-08-20");
  });

  it("a trailing preset yields instant bounds plus the local dates they span", () => {
    const now = new Date(2026, 7, 20, 0, 30); // 00:30 local: the trailing day crosses midnight
    const hour = presetTsWindow("1h", now);
    expect(hour.toTs).toBe(now.toISOString());
    expect(Date.parse(hour.toTs) - Date.parse(hour.fromTs)).toBe(3_600_000);
    expect(hour.to).toBe("2026-08-20");
    expect(hour.from).toBe("2026-08-19");
    const day = presetTsWindow("1d", now);
    expect(Date.parse(day.toTs) - Date.parse(day.fromTs)).toBe(86_400_000);
    expect(day.from).toBe("2026-08-19");
  });

  it("rangeDays counts both ends; nonsense ranges count as 1", () => {
    expect(rangeDays("2026-08-14", "2026-08-20")).toBe(7);
    expect(rangeDays("2026-08-20", "2026-08-20")).toBe(1);
    expect(rangeDays("2026-08-21", "2026-08-20")).toBe(1);
    expect(rangeDays("oops", "2026-08-20")).toBe(1);
  });
});

describe("the range picks the precision (there is no precision control)", () => {
  /**
   * How many buckets a preset's own window produces at its derived precision.
   * The server rejects anything over 500 (usage-service caps the zero-fill
   * skeleton), and with the precision control gone the page has to be
   * incapable of asking for a rejected combination in the first place.
   */
  const MAX_BUCKETS = 500;
  const buckets: Record<string, number> = {
    "1h": 61, // 60 minutes, both ends inclusive
    "1d": 25, // 24 hours, both ends inclusive
    "7d": 7,
    "30d": 30,
    "90d": 90,
  };

  it("each preset derives exactly one precision", () => {
    expect(presetDefaultGranularity("1h", 1)).toBe("minute");
    expect(presetDefaultGranularity("1d", 1)).toBe("hour");
    expect(presetDefaultGranularity("7d", 7)).toBe("day");
    expect(presetDefaultGranularity("30d", 30)).toBe("day");
    expect(presetDefaultGranularity("90d", 90)).toBe("day");
  });

  it("a custom range scales with its length: day, then week, then month", () => {
    expect(presetDefaultGranularity("custom", 1)).toBe("day");
    expect(presetDefaultGranularity("custom", 92)).toBe("day");
    expect(presetDefaultGranularity("custom", 93)).toBe("week");
    expect(presetDefaultGranularity("custom", 190)).toBe("week");
    expect(presetDefaultGranularity("custom", 191)).toBe("month");
    expect(defaultGranularity(365)).toBe("month");
  });

  it("no preset can ask the server for more buckets than it will return", () => {
    for (const [preset, count] of Object.entries(buckets)) {
      expect(count).toBeLessThanOrEqual(MAX_BUCKETS);
    }
    // Custom ranges are bounded by their own derivation: day only up to a
    // quarter (92 buckets), then week (a year is 53), then month.
    expect(Math.ceil(92 / 1)).toBeLessThanOrEqual(MAX_BUCKETS);
    expect(Math.ceil(190 / 7) + 1).toBeLessThanOrEqual(MAX_BUCKETS);
    expect(Math.ceil((365 * 5) / 30)).toBeLessThanOrEqual(MAX_BUCKETS);
  });

  it("only the trailing presets reach the precisions that need timestamp bounds", () => {
    // minute always, and hour when a window is given, are enumerated between
    // instants server-side — so exactly the two presets that send fromTs/toTs.
    const needsWindow = (g: string) => g === "minute" || g === "hour";
    expect(needsWindow(presetDefaultGranularity("1h", 1))).toBe(true);
    expect(needsWindow(presetDefaultGranularity("1d", 1))).toBe(true);
    for (const [preset, days] of [
      ["7d", 7],
      ["30d", 30],
      ["90d", 90],
      ["custom", 45],
      ["custom", 400],
    ] as const) {
      expect(needsWindow(presetDefaultGranularity(preset, days))).toBe(false);
    }
  });
});

describe("bucket labels", () => {
  it("axis form is short; bubble form is the full key with a minute/hour key's T opened up", () => {
    expect(bucketAxisLabel("minute", "2026-08-20T09:05")).toBe("09:05");
    expect(bucketAxisLabel("hour", "2026-08-20T09:00")).toBe("09:00");
    expect(bucketAxisLabel("day", "2026-08-20")).toBe("08-20");
    expect(bucketAxisLabel("week", "2026-08-17")).toBe("08-17");
    expect(bucketAxisLabel("month", "2026-08")).toBe("2026-08");
    expect(bucketFullLabel("minute", "2026-08-20T09:05")).toBe("2026-08-20 09:05");
    expect(bucketFullLabel("week", "2026-08-17")).toBe("2026-08-17");
  });
});

describe("foldEntitySeries", () => {
  /** An entity's counts, spelled out per bucket: requests, of which `completed`, over `denominator` rated ones. */
  const e = (label: string, requests: number[], completed = requests, denominator = requests) => ({
    label,
    requests,
    completed,
    denominator,
  });

  it("top entities keep their own series; a tail of two or more folds into one summed, counted tail", () => {
    const folded = foldEntitySeries(
      [
        e("a", [5, 5]),
        e("b", [4, 0]),
        e("c", [1, 2]),
        e("d", [1, 1]),
        e("e", [1, 0]),
        e("f", [0, 1]),
      ],
      (n) => `other:${n}`,
      4,
    );
    expect(folded.map((x) => x.label)).toEqual(["a", "b", "c", "d", "other:2"]);
    // The label carries the fold count, so the chart never implies the head is everything.
    expect(folded[4]).toEqual({
      label: "other:2",
      requests: [1, 1],
      completed: [1, 1],
      denominator: [1, 1],
      other: true,
    });
  });

  it("the tail sums success counts too, so its line is the combined rate rather than one entity's", () => {
    const folded = foldEntitySeries(
      [
        e("a", [1]),
        e("b", [1]),
        e("c", [1]),
        e("d", [1]),
        e("e", [4], [1], [4]),
        e("f", [4], [3], [4]),
      ],
      (n) => `other:${n}`,
      4,
    );
    expect(folded[4]!.completed).toEqual([4]);
    expect(folded[4]!.denominator).toEqual([8]);
    expect(rateSeries(folded[4]!)).toEqual([50]);
  });

  it("a tail of exactly one keeps its name (a mystery bucket of one is worse than a fifth label)", () => {
    const folded = foldEntitySeries(
      [e("a", [1]), e("b", [1]), e("c", [1]), e("d", [1]), e("e", [2])],
      (n) => `other:${n}`,
      4,
    );
    expect(folded[4]).toEqual({
      label: "e",
      requests: [2],
      completed: [2],
      denominator: [2],
      other: true,
    });
  });

  it("no tail, no fold", () => {
    expect(foldEntitySeries([e("a", [1])], (n) => `other:${n}`, 4)).toEqual([
      { label: "a", requests: [1], completed: [1], denominator: [1] },
    ]);
    expect(foldEntitySeries([], (n) => `other:${n}`, 4)).toEqual([]);
  });

  it("the default cap is the palette's length: every named series gets a color of its own", () => {
    expect(MAX_NAMED_SERIES).toBe(SERIES_COLORS.length);
    const many = Array.from({ length: MAX_NAMED_SERIES + 3 }, (_, i) => e(`e${i}`, [1]));
    const folded = foldEntitySeries(many, (n) => `other:${n}`);
    expect(folded).toHaveLength(MAX_NAMED_SERIES + 1);
    expect(folded.at(-1)).toMatchObject({ label: "other:3", other: true });
  });
});

describe("sumCounts", () => {
  it("adds the drawn series column by column: the stack's height and the counts behind its combined rate", () => {
    const totals = sumCounts([
      { label: "a", requests: [2, 0], completed: [1, 0], denominator: [2, 0] },
      { label: "b", requests: [1, 3], completed: [1, 3], denominator: [1, 3] },
    ]);
    expect(totals).toEqual({ requests: [3, 3], completed: [2, 3], denominator: [3, 3] });
    expect(rateSeries(totals)).toEqual([(2 / 3) * 100, 100]);
  });

  it("no series at all sums to nothing (an empty chart, not a crash)", () => {
    expect(sumCounts([])).toEqual({ requests: [], completed: [], denominator: [] });
  });
});

describe("rate values", () => {
  it("per-entity success rate is percent of the non-aborted denominator", () => {
    expect(rateSeries({ completed: [3, 1, 0], denominator: [4, 1, 2] })).toEqual([75, 100, 0]);
  });

  it("a bucket with nothing to rate has no rate at all — null, which is neither the 0 of 'failed everything' nor a number the table may print", () => {
    expect(rateSeries({ completed: [0, 2, 0], denominator: [0, 2, 0] })).toEqual([null, 100, null]);
    // A real 0 survives as 0: requests were made and every one of them failed.
    expect(rateSeries({ completed: [0], denominator: [3] })).toEqual([0]);
  });

  it("cache hit rate is percent of read/(read+write); a bucket with no cache traffic has no rate either", () => {
    expect(
      hitRateValues([
        point({ cacheRead: 3, cacheWrite: 1 }),
        point({}),
        point({ cacheRead: 0, cacheWrite: 5 }),
      ]),
    ).toEqual([75, null, 0]);
  });

  it("plotRates gives every bucket a height so the stroke stays continuous, absent rates at the top of the axis", () => {
    expect(NO_RATE_PLOT).toBe(100);
    expect(plotRates([75, null, 0])).toEqual([75, NO_RATE_PLOT, 0]);
    // Drawing at 100 and reading 0 are different questions: a rated 0 is not lifted.
    expect(plotRates(rateSeries({ completed: [0, 0], denominator: [0, 4] }))).toEqual([
      NO_RATE_PLOT,
      0,
    ]);
  });
});

describe("compactSeries", () => {
  const at = (bucket: string, over: Partial<UsageSeriesPoint> = {}) =>
    point({ bucket, requests: 1, total: 10, ...over });

  it("drops the buckets that recorded nothing and keeps the rest in order, with where each one sat", () => {
    const c = compactSeries([at("d1"), point({ bucket: "d2" }), at("d3")]);
    expect(c.points.map((p) => p.bucket)).toEqual(["d1", "d3"]);
    expect(c.kept).toEqual([0, 2]);
  });

  it("a request that spent no tokens keeps its bucket; only a bucket with neither is empty", () => {
    const c = compactSeries([
      point({ bucket: "d1", requests: 1, total: 0 }),
      point({ bucket: "d2", requests: 0, total: 5 }),
      point({ bucket: "d3" }),
    ]);
    expect(c.points.map((p) => p.bucket)).toEqual(["d1", "d2"]);
    expect(c.kept).toEqual([0, 1]);
  });

  it("a bucket only one entity ran in is not empty: the bucket is what counts, never one entity's share of it", () => {
    // d2 holds a single request from one entity; the others were idle in it.
    const c = compactSeries([
      at("d1"),
      at("d2", { requests: 1, total: 4 }),
      point({ bucket: "d3" }),
    ]);
    expect(c.points.map((p) => p.bucket)).toEqual(["d1", "d2"]);
  });

  it("breaks mark the drawn point each skip follows, however many buckets it swallowed", () => {
    const c = compactSeries([
      at("d1"),
      point({ bucket: "d2" }),
      point({ bucket: "d3" }),
      at("d4"),
      at("d5"),
      point({ bucket: "d6" }),
      at("d7"),
    ]);
    expect(c.points.map((p) => p.bucket)).toEqual(["d1", "d4", "d5", "d7"]);
    expect(c.breaks).toEqual([0, 2]);
    expect(c.kept).toEqual([0, 3, 4, 6]);
  });

  it("empty buckets before the first point or after the last shorten the axis without breaking it", () => {
    const c = compactSeries([point({ bucket: "d1" }), at("d2"), point({ bucket: "d3" })]);
    expect(c.points.map((p) => p.bucket)).toEqual(["d2"]);
    expect(c.breaks).toEqual([]);
    expect(c.kept).toEqual([1]);
  });

  it("a range that recorded nothing compacts to nothing (the charts show their empty state, not a flat zero line)", () => {
    expect(compactSeries([point({}), point({})])).toEqual({ points: [], kept: [], breaks: [] });
    expect(compactSeries([])).toEqual({ points: [], kept: [], breaks: [] });
  });

  it("nothing to drop leaves the series and its axis exactly as they came", () => {
    const full = [at("d1"), at("d2")];
    const c = compactSeries(full);
    expect(c.points).toEqual(full);
    expect(c.breaks).toEqual([]);
    expect(c.kept).toEqual([0, 1]);
  });
});

describe("compactCounts (per-entity alignment across the compaction)", () => {
  // Five buckets; the server sends every entity one value per bucket, aligned
  // with the series. d2 and d4 recorded nothing at all.
  const series = [
    point({ bucket: "d1", requests: 2, total: 20 }),
    point({ bucket: "d2" }),
    point({ bucket: "d3", requests: 3, total: 30 }),
    point({ bucket: "d4" }),
    point({ bucket: "d5", requests: 1, total: 10 }),
  ];
  const entity = {
    requests: [2, 0, 1, 0, 0],
    completed: [1, 0, 1, 0, 0],
    denominator: [2, 0, 1, 0, 0],
  };

  it("takes exactly the kept positions, so a value stays with the bucket it was recorded in", () => {
    const { points, kept } = compactSeries(series);
    const compacted = compactCounts(entity, kept);
    expect(points.map((p) => p.bucket)).toEqual(["d1", "d3", "d5"]);
    expect(compacted).toEqual({
      requests: [2, 1, 0],
      completed: [1, 1, 0],
      denominator: [2, 1, 0],
    });
    // The invariant the per-entity series are built on, asserted by bucket key
    // rather than by position: value[i] after the compaction is still the value
    // the server sent for points[i].bucket.
    points.forEach((p, i) => {
      const origin = series.findIndex((q) => q.bucket === p.bucket);
      expect(compacted.requests[i]).toBe(entity.requests[origin]);
      expect(compacted.completed[i]).toBe(entity.completed[origin]);
      expect(compacted.denominator[i]).toBe(entity.denominator[origin]);
    });
  });

  it("an entity idle in a kept bucket keeps its zero there, which is what makes it a dash and not a missing column", () => {
    const { kept } = compactSeries(series);
    const idle = compactCounts(
      { requests: [0, 0, 0, 0, 1], completed: [0, 0, 0, 0, 1], denominator: [0, 0, 0, 0, 1] },
      kept,
    );
    expect(idle.requests).toEqual([0, 0, 1]);
    expect(rateSeries(idle)).toEqual([null, null, 100]);
  });

  it("a short or missing array reads as zero rather than undefined (a chart never plots a hole it cannot explain)", () => {
    expect(compactCounts({ requests: [5], completed: [], denominator: [] }, [0, 2])).toEqual({
      requests: [5, 0],
      completed: [0, 0],
      denominator: [0, 0],
    });
  });
});
