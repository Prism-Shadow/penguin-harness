/**
 * Cost center control + series-shaping helper tests (usage-controls.ts): range
 * presets, the range↔precision constraint (offered options, defaults, snapping),
 * bucket-key labels, calls-series folding (top Agents + a neutral "other"
 * tail), and the per-bucket success / cache-hit rate values the smooth lines
 * draw.
 */
import { describe, expect, it } from "vitest";
import type { UsageSeriesPoint } from "@prismshadow/penguin-server/api";
import {
  bucketAxisLabel,
  bucketFullLabel,
  callsSeries,
  coerceGranularity,
  defaultGranularity,
  granularityOptions,
  hitRateValues,
  isoDate,
  presetRange,
  rangeDays,
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

describe("presetRange / rangeDays", () => {
  it("a preset ends today and spans its day count inclusively", () => {
    const today = new Date(2026, 7, 20); // 2026-08-20 local
    expect(presetRange("7d", today)).toEqual({ from: "2026-08-14", to: "2026-08-20" });
    expect(presetRange("30d", today)).toEqual({ from: "2026-07-22", to: "2026-08-20" });
    expect(presetRange("90d", today)).toEqual({ from: "2026-05-23", to: "2026-08-20" });
    expect(isoDate(today)).toBe("2026-08-20");
  });

  it("rangeDays counts both ends; nonsense ranges count as 1", () => {
    expect(rangeDays("2026-08-14", "2026-08-20")).toBe(7);
    expect(rangeDays("2026-08-20", "2026-08-20")).toBe(1);
    expect(rangeDays("2026-08-21", "2026-08-20")).toBe(1);
    expect(rangeDays("oops", "2026-08-20")).toBe(1);
  });
});

describe("granularity options / defaults / snapping", () => {
  it("hourly only for short ranges, weekly/monthly only once the range fills them", () => {
    expect(granularityOptions(7)).toEqual(["hour", "day"]);
    expect(granularityOptions(30)).toEqual(["day", "week"]);
    expect(granularityOptions(90)).toEqual(["day", "week", "month"]);
    expect(granularityOptions(400)).toEqual(["week", "month"]);
  });

  it("defaults scale with the range", () => {
    expect(defaultGranularity(7)).toBe("day");
    expect(defaultGranularity(90)).toBe("day");
    expect(defaultGranularity(180)).toBe("week");
    expect(defaultGranularity(365)).toBe("month");
  });

  it("a range change keeps a still-valid precision and snaps an invalid one", () => {
    expect(coerceGranularity("day", 90)).toBe("day");
    expect(coerceGranularity("hour", 90)).toBe("day");
    expect(coerceGranularity("month", 30)).toBe("day");
    expect(coerceGranularity("week", 30)).toBe("week");
  });
});

describe("bucket labels", () => {
  it("axis form is short; bubble form is the full key with an hour's T opened up", () => {
    expect(bucketAxisLabel("hour", "2026-08-20T09:00")).toBe("09:00");
    expect(bucketAxisLabel("day", "2026-08-20")).toBe("08-20");
    expect(bucketAxisLabel("week", "2026-08-17")).toBe("08-17");
    expect(bucketAxisLabel("month", "2026-08")).toBe("2026-08");
    expect(bucketFullLabel("hour", "2026-08-20T09:00")).toBe("2026-08-20 09:00");
    expect(bucketFullLabel("week", "2026-08-17")).toBe("2026-08-17");
  });
});

describe("callsSeries", () => {
  const s = (agentId: string, requests: number[]) => ({ agentId, requests });

  it('top agents keep their own series; a tail of two or more folds into one summed "other"', () => {
    const folded = callsSeries(
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
    expect(folded[4]).toEqual({ label: "other", values: [1, 1], other: true });
  });

  it("a tail of exactly one keeps its name (a mystery bucket of one is worse than a fifth label)", () => {
    const folded = callsSeries(
      [s("a", [1]), s("b", [1]), s("c", [1]), s("d", [1]), s("e", [2])],
      "other",
      4,
    );
    expect(folded[4]).toEqual({ label: "e", values: [2], other: true });
  });

  it("no tail, no other", () => {
    expect(callsSeries([s("a", [1])], "other", 4)).toEqual([{ label: "a", values: [1] }]);
    expect(callsSeries([], "other", 4)).toEqual([]);
  });
});

describe("rate values", () => {
  it("success rate is percent of the non-aborted denominator; an idle bucket counts as 100", () => {
    expect(
      successRateValues([
        point({ completed: 3, denominator: 4 }),
        point({}),
        point({ completed: 0, denominator: 2 }),
      ]),
    ).toEqual([75, 100, 0]);
  });

  it("cache hit rate is percent of read/(read+write); no cache traffic is a gap (null), not a 0", () => {
    expect(
      hitRateValues([
        point({ cacheRead: 3, cacheWrite: 1 }),
        point({}),
        point({ cacheRead: 0, cacheWrite: 5 }),
      ]),
    ).toEqual([75, null, 0]);
  });
});
