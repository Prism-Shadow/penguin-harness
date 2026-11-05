/**
 * The clock arithmetic the live widgets share (src/components/content/a2ui/time-format.ts): a
 * zone's time on a 12- or 24-hour clock, its weekday and date in the block's language, and how far
 * it runs from the reader's own zone — measured against two fixed zones, so the suite passes in
 * whatever zone the runner keeps.
 */
import { describe, expect, it } from "vitest";
import { hourLabel, offsetLabel, timeParts } from "../src/components/content/a2ui/time-format";

/** 14:05:09 in Shanghai on Sunday 2026-10-04. */
const AT = Date.UTC(2026, 9, 4, 6, 5, 9);

describe("timeParts", () => {
  it("reads a zone's clock on 24 hours, its weekday and date, and seconds when asked", () => {
    const zh = timeParts(AT, "Asia/Shanghai", "24", "zh", false);
    expect(zh.time).toBe("14:05");
    expect(zh.dayPeriod).toBeUndefined();
    expect([zh.weekday, zh.date]).toEqual(["周日", "10月4日"]);
    expect(zh.iso).toBe("2026-10-04T06:05:09.000Z");
    expect([zh.hour, zh.minute, zh.second]).toEqual([14, 5, 9]);
    expect(timeParts(AT, "Asia/Shanghai", "24", "en", true).time).toBe("14:05:09");
  });

  it("reads 12 hours with the day period, and the language's own cycle on auto", () => {
    const en = timeParts(AT, "Asia/Shanghai", "12", "en", false);
    expect([en.time, en.dayPeriod, en.weekday, en.date]).toEqual(["2:05", "PM", "Sun", "Oct 4"]);
    expect(timeParts(AT, "Asia/Shanghai", "12", "zh", false).dayPeriod).toBe("下午");
    expect(timeParts(AT, "Asia/Shanghai", "auto", "en", false).dayPeriod).toBe("PM");
    expect(timeParts(AT, "Asia/Shanghai", "auto", "zh", false).time).toBe("14:05");
  });

  it("says how far a zone runs from the reader's own, in hours", () => {
    const offset = (zone: string) => timeParts(AT, zone, "24", "en", false).offsetHours;
    // Tokyo is UTC+9, New York on summer time UTC−4, Delhi UTC+5:30.
    expect(offset("Asia/Tokyo") - offset("America/New_York")).toBe(13);
    expect(offset("Asia/Tokyo") - offset("Asia/Kolkata")).toBe(3.5);
    expect(offset("local")).toBe(0);
    expect(offset(Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(0);
    expect([offsetLabel(7), offsetLabel(-3.5), offsetLabel(0)]).toEqual(["+7 h", "−3.5 h", ""]);
  });
});

describe("hourLabel", () => {
  it("keeps a clock time and reads an instant in the reader's zone", () => {
    expect(hourLabel("09:00")).toBe("09:00");
    expect(hourLabel(new Date(2026, 9, 4, 15, 30).toISOString())).toBe("15:30");
  });
});
