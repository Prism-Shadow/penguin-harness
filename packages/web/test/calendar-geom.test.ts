/**
 * calendar-geom.ts unit tests: the month grid (as many Monday-based rows as the month
 * needs), the week, the view ranges and stepping, period parsing, the expansion of an
 * event's startAt / period / endAt into the instances of a range — including which past
 * instance carries the recorded outcome — the cadence an event reads as, and the lanes
 * overlapping chips take. Dates are built with the local Date constructor, so the
 * assertions hold in every timezone.
 */
import { describe, expect, it } from "vitest";
import type { OrgCalendarItem } from "@prismshadow/penguin-server/api";
import {
  MAX_INSTANCES_PER_EVENT,
  addDays,
  cadenceOf,
  chipLanes,
  dayFraction,
  dayKey,
  expandEvents,
  instancesByDay,
  monthGrid,
  parsePeriodMs,
  shiftAnchor,
  startOfWeek,
  timeLabel,
  toLocalInput,
  viewRange,
  weekDays,
} from "../src/features/company/calendar-geom";

const local = (y: number, m0: number, d: number, h = 0, min = 0) =>
  new Date(y, m0, d, h, min).getTime();

function event(over: Partial<OrgCalendarItem> & { startAt: string }): OrgCalendarItem {
  return {
    agentId: "ceo",
    name: "standup",
    prompt: "check the board",
    enabled: true,
    status: "active",
    paused: false,
    ...over,
  };
}

describe("day and week arithmetic", () => {
  it("keys a day as yyyy-mm-dd and finds the Monday of its week", () => {
    // 2026-09-02 is a Wednesday.
    expect(dayKey(local(2026, 8, 2, 15))).toBe("2026-09-02");
    expect(dayKey(startOfWeek(local(2026, 8, 2, 15)))).toBe("2026-08-31");
    // A Sunday belongs to the week that started six days earlier.
    expect(dayKey(startOfWeek(local(2026, 8, 6)))).toBe("2026-08-31");
    expect(dayKey(addDays(local(2026, 8, 30), 1))).toBe("2026-10-01");
  });

  it("lays the month out as Monday-based rows, only as many as it needs, marking the days outside it", () => {
    // September 2026: Tuesday the 1st to Wednesday the 30th spans five Monday-based weeks.
    const grid = monthGrid(local(2026, 8, 15));
    expect(grid).toHaveLength(5);
    expect(grid.every((row) => row.length === 7)).toBe(true);
    expect(grid[0]![0]!.key).toBe("2026-08-31");
    expect(grid[0]![0]!.inMonth).toBe(false);
    expect(grid[0]![1]!.key).toBe("2026-09-01");
    expect(grid[0]![1]!.inMonth).toBe(true);
    expect(grid[4]![6]!.key).toBe("2026-10-04");
    expect(grid[4]![6]!.inMonth).toBe(false);
    // August 2026 starts on a Saturday and ends on a Monday: six rows.
    expect(monthGrid(local(2026, 7, 10))).toHaveLength(6);
    // February 2027 starts on a Monday and has 28 days: exactly four.
    expect(monthGrid(local(2027, 1, 10))).toHaveLength(4);
  });

  it("the week is Monday to Sunday around the anchor", () => {
    expect(weekDays(local(2026, 8, 2)).map((d) => d.key)).toEqual([
      "2026-08-31",
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
      "2026-09-06",
    ]);
  });

  it("view ranges are half-open and cover exactly the view", () => {
    const day = viewRange(local(2026, 8, 2, 10), "day");
    expect([dayKey(day.startMs), dayKey(day.endMs)]).toEqual(["2026-09-02", "2026-09-03"]);
    const week = viewRange(local(2026, 8, 2, 10), "week");
    expect([dayKey(week.startMs), dayKey(week.endMs)]).toEqual(["2026-08-31", "2026-09-07"]);
    const month = viewRange(local(2026, 8, 2, 10), "month");
    expect([dayKey(month.startMs), dayKey(month.endMs)]).toEqual(["2026-08-31", "2026-10-05"]);
  });

  it("steps the anchor by a day, a week or a month — clamping the day of a shorter month", () => {
    expect(dayKey(shiftAnchor(local(2026, 8, 2), "day", 1))).toBe("2026-09-03");
    expect(dayKey(shiftAnchor(local(2026, 8, 2), "week", -1))).toBe("2026-08-26");
    expect(dayKey(shiftAnchor(local(2026, 0, 31), "month", 1))).toBe("2026-02-28");
    expect(dayKey(shiftAnchor(local(2026, 0, 15), "month", -1))).toBe("2025-12-15");
  });

  it("places an instant in its day and labels it", () => {
    expect(dayFraction(local(2026, 8, 2, 12, 0))).toBe(0.5);
    expect(dayFraction(local(2026, 8, 2, 0, 0))).toBe(0);
    expect(timeLabel(local(2026, 8, 2, 9, 5))).toBe("09:05");
    expect(toLocalInput(new Date(local(2026, 8, 2, 9, 5)).toISOString())).toBe("2026-09-02T09:05");
    expect(toLocalInput(undefined)).toBe("");
    expect(toLocalInput("nope")).toBe("");
  });
});

describe("parsePeriodMs", () => {
  it("accepts the server's m / h / d forms and nothing else", () => {
    expect(parsePeriodMs("30m")).toBe(30 * 60_000);
    expect(parsePeriodMs("12h")).toBe(12 * 3_600_000);
    expect(parsePeriodMs("7d")).toBe(7 * 24 * 3_600_000);
    for (const raw of ["", "0m", "1w", "5", "m", "-1h", undefined]) {
      expect(parsePeriodMs(raw)).toBeNull();
    }
  });
});

describe("expandEvents", () => {
  const rangeStart = local(2026, 8, 1);
  const rangeEnd = local(2026, 8, 8);
  const now = local(2026, 8, 3, 12);

  it("expands a periodic event across the range, skipping the part before it and stopping at endAt", () => {
    const daily = event({
      startAt: new Date(local(2026, 7, 20, 9)).toISOString(),
      period: "1d",
      endAt: new Date(local(2026, 8, 5, 9)).toISOString(),
    });
    const out = expandEvents([daily], rangeStart, rangeEnd, now);
    expect(out.map((i) => dayKey(i.atMs))).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
      "2026-09-04",
      "2026-09-05",
    ]);
    expect(out.map((i) => i.past)).toEqual([true, true, true, false, false]);
    expect(out[0]!.key).toBe(`ceo/standup@${local(2026, 8, 1, 9)}`);
  });

  it("a one-off yields at most its own instant, inside the range only", () => {
    const inRange = event({
      name: "kickoff",
      startAt: new Date(local(2026, 8, 2, 14)).toISOString(),
    });
    const outside = event({
      name: "later",
      startAt: new Date(local(2026, 9, 2, 14)).toISOString(),
    });
    const out = expandEvents([inRange, outside], rangeStart, rangeEnd, now);
    expect(out.map((i) => i.event.name)).toEqual(["kickoff"]);
  });

  it("pins the recorded outcome to the instance nearest lastFiredAt and leaves other past instances without a claim", () => {
    const daily = event({
      startAt: new Date(local(2026, 8, 1, 9)).toISOString(),
      period: "1d",
      // Fired twenty seconds after the 09:00 slot of the 3rd: well inside half a period.
      lastFiredAt: new Date(new Date(2026, 8, 3, 9, 0, 20).getTime()).toISOString(),
      lastOutcome: "fired",
    });
    const out = expandEvents([daily], rangeStart, rangeEnd, now);
    expect(out.map((i) => i.outcome)).toEqual([null, null, "fired", null, null, null, null]);
  });

  it("drops events it cannot place and caps a runaway period", () => {
    const bad = event({ startAt: "not a date" });
    const badPeriod = event({
      name: "p",
      startAt: new Date(rangeStart).toISOString(),
      period: "1w",
    });
    expect(expandEvents([bad, badPeriod], rangeStart, rangeEnd, now)).toEqual([]);
    const tiny = event({ name: "t", startAt: new Date(rangeStart).toISOString(), period: "1m" });
    expect(expandEvents([tiny], rangeStart, rangeEnd, now)).toHaveLength(MAX_INSTANCES_PER_EVENT);
  });

  it("buckets instances by day and orders employees by first appearance", () => {
    const a = event({ agentId: "a", startAt: new Date(local(2026, 8, 2, 9)).toISOString() });
    const b = event({
      agentId: "b",
      name: "x",
      startAt: new Date(local(2026, 8, 2, 11)).toISOString(),
    });
    const byDay = instancesByDay(expandEvents([b, a], rangeStart, rangeEnd, now));
    expect([...byDay.keys()]).toEqual(["2026-09-02"]);
    expect(byDay.get("2026-09-02")!.map((i) => i.event.agentId)).toEqual(["a", "b"]);
  });
});

describe("cadenceOf", () => {
  const start = new Date(local(2026, 8, 2, 9, 30)).toISOString();

  it("reads whole-day periods as day and week cadences with the time of day", () => {
    expect(cadenceOf({ startAt: start, period: "1d" })).toEqual({
      kind: "days",
      n: 1,
      time: "09:30",
    });
    expect(cadenceOf({ startAt: start, period: "3d" })).toEqual({
      kind: "days",
      n: 3,
      time: "09:30",
    });
    expect(cadenceOf({ startAt: start, period: "7d" })).toEqual({
      kind: "weeks",
      n: 1,
      time: "09:30",
    });
    expect(cadenceOf({ startAt: start, period: "14d" })).toEqual({
      kind: "weeks",
      n: 2,
      time: "09:30",
    });
  });

  it("keeps sub-day periods in their own unit, and no period is a one-off", () => {
    expect(cadenceOf({ startAt: start, period: "12h" })).toEqual({ kind: "hours", n: 12 });
    expect(cadenceOf({ startAt: start, period: "90m" })).toEqual({ kind: "minutes", n: 90 });
    expect(cadenceOf({ startAt: start, period: "48h" })).toEqual({
      kind: "days",
      n: 2,
      time: "09:30",
    });
    expect(cadenceOf({ startAt: start })).toEqual({ kind: "once", atMs: local(2026, 8, 2, 9, 30) });
  });

  it("is invalid for an unparseable start or period", () => {
    expect(cadenceOf({ startAt: "nope", period: "1d" })).toEqual({ kind: "invalid" });
    expect(cadenceOf({ startAt: start, period: "1w" })).toEqual({ kind: "invalid" });
  });
});

describe("chipLanes", () => {
  const slot = 30 * 60_000;
  const at = (h: number, m: number, key: string) => ({ atMs: local(2026, 8, 2, h, m), key });

  it("gives a lone chip the full width and packs overlapping chips side by side", () => {
    const out = chipLanes([at(14, 0, "c"), at(9, 0, "a"), at(9, 10, "b")], slot);
    expect(out.map((s) => [s.item.key, s.lane, s.lanes])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 1],
    ]);
  });

  it("chains overlaps into one cluster and reuses a lane once it is free", () => {
    // a 09:00–09:30, b 09:20–09:50, c 09:40–10:10: b overlaps both, a and c can share lane 0.
    const out = chipLanes([at(9, 0, "a"), at(9, 20, "b"), at(9, 40, "c")], slot);
    expect(out.map((s) => [s.item.key, s.lane, s.lanes])).toEqual([
      ["a", 0, 2],
      ["b", 1, 2],
      ["c", 0, 2],
    ]);
  });

  it("touching slots do not overlap, and the same instant sorts by key", () => {
    const out = chipLanes([at(9, 30, "b"), at(9, 0, "a"), at(9, 0, "c")], slot);
    expect(out.map((s) => [s.item.key, s.lane, s.lanes])).toEqual([
      ["a", 0, 2],
      ["c", 1, 2],
      ["b", 0, 1],
    ]);
    expect(chipLanes([], slot)).toEqual([]);
  });
});
