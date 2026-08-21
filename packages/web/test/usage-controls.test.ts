/**
 * Cost center control + series-shaping helper tests (usage-controls.ts): range
 * presets (calendar and trailing timestamp windows), the preset↔precision
 * matrix (offered options, defaults, snapping), bucket-key labels, entity
 * folding for the requests chart's stacked bars (top entities + a neutral
 * "other" tail), and the per-bucket success / cache-hit rate values the lines
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
  presetDefaultGranularity,
  presetGranularities,
  presetRange,
  presetTsWindow,
  rangeDays,
  rateSeries,
  successRateValues,
} from "../src/features/usage/usage-controls";

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
  const s = (label: string, requests: number[]) => ({ label, requests });

  it('top entities keep their own series; a tail of two or more folds into one summed "other"', () => {
    const folded = foldEntitySeries(
      [
        s("a", [5, 5]),
        s("b", [4, 0]),
        s("c", [1, 2]),
        s("d", [1, 1]),
        s("e", [1, 0]),
        s("f", [0, 1]),
      ],
      "other",
      4,
    );
    expect(folded.map((x) => x.label)).toEqual(["a", "b", "c", "d", "other"]);
    expect(folded[4]).toEqual({ label: "other", requests: [1, 1], other: true });
  });

  it("a tail of exactly one keeps its name (a mystery bucket of one is worse than a fifth label)", () => {
    const folded = foldEntitySeries(
      [s("a", [1]), s("b", [1]), s("c", [1]), s("d", [1]), s("e", [2])],
      "other",
      4,
    );
    expect(folded[4]).toEqual({ label: "e", requests: [2], other: true });
  });

  it("no tail, no other", () => {
    expect(foldEntitySeries([s("a", [1])], "other", 4)).toEqual([{ label: "a", requests: [1] }]);
    expect(foldEntitySeries([], "other", 4)).toEqual([]);
  });
});

describe("rate values", () => {
  it("overall success rate is percent of the non-aborted denominator; an idle bucket counts as 100", () => {
    expect(
      successRateValues([
        point({ completed: 3, denominator: 4 }),
        point({}),
        point({ completed: 0, denominator: 2 }),
      ]),
    ).toEqual([75, 100, 0]);
  });

  it("per-entity success rate reads the paired count arrays with the same idle convention", () => {
    expect(rateSeries({ completed: [3, 0, 0], denominator: [4, 0, 2] })).toEqual([75, 100, 0]);
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
