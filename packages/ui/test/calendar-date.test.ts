/**
 * The date pickers' calendar arithmetic (src/components/forms/date-time/calendar-date.ts) and the
 * keys a month grid moves by (calendar-keys.ts).
 *
 * - Given the native inputs' formats, a value reads back exactly as written; a day, a month or a
 *   time that does not exist reads as no value.
 * - Given a month end, a month later holds the day to the shorter month, leap years included.
 * - Given a week that starts on Monday or on Sunday, the six weeks a grid draws start on that day
 *   and the 1st sits in the first.
 * - Given a reader west of Greenwich late in the evening, today is the reader's own date; a day
 *   step across a daylight-saving change lands on the next day, in any zone.
 * - Given a key, the focus moves by a day, a week, to the week's edges, or by a month (a year with
 *   Shift), across the month's edge; any other key moves nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  addDays,
  addMonths,
  dateTimeValue,
  dateValue,
  monthWeeks,
  parseDate,
  parseDateTime,
  parseTime,
  timeValue,
  todayOf,
  weekdayOf,
} from "../src/components/forms/date-time/calendar-date";
import { gridKeyTarget } from "../src/components/forms/date-time/calendar-keys";

const day = (value: string) => {
  const parsed = parseDate(value);
  if (parsed === null) throw new Error(`not a date: ${value}`);
  return parsed;
};

const realZone = process.env.TZ;
/** Node re-reads `TZ` on every call, so this puts the reader in `zone` until the test ends. */
const inZone = (zone: string) => {
  process.env.TZ = zone;
};
afterEach(() => {
  if (realZone === undefined) delete process.env.TZ;
  else process.env.TZ = realZone;
});

describe("values", () => {
  it("reads the native formats back exactly as written", () => {
    expect(dateValue(day("2026-11-12"))).toBe("2026-11-12");
    expect(dateValue(day("0999-01-01"))).toBe("0999-01-01");
    expect(timeValue(parseTime("09:05")!)).toBe("09:05");
    const both = parseDateTime("2026-02-28T23:59")!;
    expect(dateTimeValue(both.date, both.time)).toBe("2026-02-28T23:59");
  });

  it("reads a day, a month or a time that does not exist as no value", () => {
    expect(parseDate("2026-02-29")).toBeNull();
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("2026-04-31")).toBeNull();
    expect(parseDate("2026-1-5")).toBeNull();
    expect(parseDate("")).toBeNull();
    expect(parseTime("24:00")).toBeNull();
    expect(parseTime("9:30")).toBeNull();
    expect(parseDateTime("2026-11-12 09:30")).toBeNull();
    expect(parseDate("2028-02-29")).not.toBeNull();
  });
});

describe("month steps", () => {
  it("holds a month end to the shorter month, leap years included", () => {
    expect(dateValue(addMonths(day("2026-01-31"), 1))).toBe("2026-02-28");
    expect(dateValue(addMonths(day("2028-01-31"), 1))).toBe("2028-02-29");
    expect(dateValue(addMonths(day("2026-03-31"), -1))).toBe("2026-02-28");
    expect(dateValue(addMonths(day("2026-12-15"), 1))).toBe("2027-01-15");
    expect(dateValue(addMonths(day("2026-01-15"), -13))).toBe("2024-12-15");
  });
});

describe("month weeks", () => {
  it.each([
    ["Monday", 1, "2026-10-26"],
    ["Sunday", 0, "2026-11-01"],
  ] as const)("start every week on %s and hold the 1st in the first", (_, firstDay, start) => {
    const weeks = monthWeeks({ year: 2026, month: 11 }, firstDay);
    expect(weeks).toHaveLength(6);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.every((week) => weekdayOf(week[0]!) === firstDay)).toBe(true);
    expect(dateValue(weeks[0]![0]!)).toBe(start);
    expect(weeks[0]!.map(dateValue)).toContain("2026-11-01");
  });
});

describe("zones", () => {
  it("takes today from the reader's own calendar, west of Greenwich in the evening", () => {
    inZone("America/Los_Angeles");
    // 05:30 UTC on 13 November is 21:30 on 12 November in Los Angeles.
    expect(dateValue(todayOf(new Date("2026-11-13T05:30:00Z")))).toBe("2026-11-12");
    inZone("Asia/Tokyo");
    expect(dateValue(todayOf(new Date("2026-11-12T20:30:00Z")))).toBe("2026-11-13");
  });

  it.each(["America/New_York", "America/Sao_Paulo", "Asia/Shanghai", "UTC"])(
    "steps a day across a daylight-saving change in %s",
    (zone) => {
      inZone(zone);
      expect(dateValue(addDays(day("2026-03-08"), 1))).toBe("2026-03-09");
      expect(dateValue(addDays(day("2026-11-01"), -1))).toBe("2026-10-31");
      expect(weekdayOf(day("2026-11-12"))).toBe(4);
    },
  );
});

describe("grid keys", () => {
  const move = (key: string, from: string, firstDay: 0 | 1 = 1, shift = false) => {
    const target = gridKeyTarget(key, day(from), firstDay, shift);
    return target === null ? null : dateValue(target);
  };

  it("moves by a day and a week across the month's edge", () => {
    expect(move("ArrowRight", "2026-11-30")).toBe("2026-12-01");
    expect(move("ArrowLeft", "2026-12-01")).toBe("2026-11-30");
    expect(move("ArrowDown", "2026-11-26")).toBe("2026-12-03");
    expect(move("ArrowUp", "2026-01-03")).toBe("2025-12-27");
  });

  it("moves to the week's edges by the locale's first day", () => {
    // Thursday 12 November 2026.
    expect(move("Home", "2026-11-12", 1)).toBe("2026-11-09");
    expect(move("End", "2026-11-12", 1)).toBe("2026-11-15");
    expect(move("Home", "2026-11-12", 0)).toBe("2026-11-08");
    expect(move("End", "2026-11-12", 0)).toBe("2026-11-14");
  });

  it("moves by a month, or a year with Shift", () => {
    expect(move("PageUp", "2026-03-31")).toBe("2026-02-28");
    expect(move("PageDown", "2026-12-10")).toBe("2027-01-10");
    expect(move("PageDown", "2026-11-12", 1, true)).toBe("2027-11-12");
    expect(move("PageUp", "2028-02-29", 1, true)).toBe("2027-02-28");
  });

  it("moves nothing on any other key", () => {
    expect(move("Enter", "2026-11-12")).toBeNull();
    expect(move("a", "2026-11-12")).toBeNull();
  });
});
