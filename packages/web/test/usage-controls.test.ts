/**
 * Cost center control + series-shaping helper tests (usage-controls.ts): range
 * presets (calendar and trailing timestamp windows), the preset↔precision
 * matrix (offered options, defaults, snapping), bucket-key labels, entity
 * folding for the requests chart's stacked bars (top entities + a neutral
 * counted tail), and the per-bucket success / cache-hit rate values the lines
 * draw.
 */
import { describe, expect, it } from "vitest";
import type { UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import {
  bucketAxisLabel,
  bucketFullLabel,
  coerceGranularity,
  defaultGranularity,
  foldEntitySeries,
  granularityOptions,
  hitRateValues,
  isoDate,
  MAX_NAMED_SERIES,
  presetDefaultGranularity,
  presetGranularities,
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

describe("preset × precision matrix", () => {
  it("each preset offers its own precisions; custom follows the range", () => {
    expect(presetGranularities("1h", 1)).toEqual(["minute"]);
    expect(presetGranularities("1d", 1)).toEqual(["hour"]);
    expect(presetGranularities("7d", 7)).toEqual(["hour", "day"]);
    expect(presetGranularities("30d", 30)).toEqual(["day", "week"]);
    expect(presetGranularities("90d", 90)).toEqual(["day", "week"]);
    expect(presetGranularities("custom", 7)).toEqual(["hour", "day"]);
    expect(presetGranularities("custom", 90)).toEqual(["day", "week", "month"]);
    expect(presetGranularities("custom", 400)).toEqual(["week", "month"]);
  });

  it("custom-range options gate hourly by readability and weekly/monthly by fill", () => {
    expect(granularityOptions(7)).toEqual(["hour", "day"]);
    expect(granularityOptions(30)).toEqual(["day", "week"]);
    expect(granularityOptions(90)).toEqual(["day", "week", "month"]);
  });

  it("defaults: trailing presets take their only sensible unit, calendar presets take day, custom scales with the range", () => {
    expect(presetDefaultGranularity("1h", 1)).toBe("minute");
    expect(presetDefaultGranularity("1d", 1)).toBe("hour");
    expect(presetDefaultGranularity("7d", 7)).toBe("day");
    expect(presetDefaultGranularity("90d", 90)).toBe("day");
    expect(presetDefaultGranularity("custom", 180)).toBe("week");
    expect(defaultGranularity(365)).toBe("month");
  });

  it("a preset change keeps a still-valid precision and snaps an invalid one", () => {
    expect(coerceGranularity("day", "30d", 30)).toBe("day");
    expect(coerceGranularity("minute", "30d", 30)).toBe("day");
    expect(coerceGranularity("day", "1h", 1)).toBe("minute");
    expect(coerceGranularity("hour", "7d", 7)).toBe("hour");
    expect(coerceGranularity("month", "custom", 90)).toBe("month");
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

  it("a bucket with nothing rated is a hole, not a 100%: the line breaks instead of claiming a perfect record", () => {
    expect(rateSeries({ completed: [0, 2, 0], denominator: [0, 2, 0] })).toEqual([null, 100, null]);
  });

  it("cache hit rate is percent of read/(read+write); no cache traffic counts as 0 so the curve runs continuously", () => {
    expect(
      hitRateValues([
        point({ cacheRead: 3, cacheWrite: 1 }),
        point({}),
        point({ cacheRead: 0, cacheWrite: 5 }),
      ]),
    ).toEqual([75, 0, 0]);
  });
});
