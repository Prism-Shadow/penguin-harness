/**
 * Cost center control + series-shaping helper tests (usage-controls.ts): range
 * presets (calendar and trailing timestamp windows), the precision each range
 * derives (there is no precision control) and the bucket counts that keeps
 * inside the server's cap, bucket-key labels, entity
 * folding for the requests chart's stacked bars (top entities + a neutral
 * counted tail), and the per-bucket success / cache-hit rate values the lines
 * draw.
 */
import { describe, expect, it } from "vitest";
import type { UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import {
  bucketAxisLabel,
  bucketFullLabel,
  defaultGranularity,
  foldEntitySeries,
  hitRateValues,
  idleBuckets,
  isoDate,
  MAX_NAMED_SERIES,
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

  it("a bucket with nothing rated plots 0 — not a gap, and emphatically not 100%", () => {
    expect(rateSeries({ completed: [0, 2, 0], denominator: [0, 2, 0] })).toEqual([0, 100, 0]);
    // 0 therefore means two things; idleBuckets is what lets the hover text say which.
    expect(idleBuckets({ denominator: [0, 2, 0] })).toEqual([true, false, true]);
    expect(idleBuckets({ denominator: [1, 0] })).toEqual([false, true]);
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
