/**
 * The human schedule line (src/features/schedules/schedule-describe.ts): periods folded into
 * everyday words, a one-off's fire time relative to today, the next trigger of an armed
 * repeating task, and the settled states named up front — in the English dictionary.
 *
 * Every instant is built from LOCAL calendar parts, so the expectations hold in whatever
 * timezone the test box runs in.
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  describeInstant,
  describeSchedule,
  periodMinutes,
} from "../src/features/schedules/schedule-describe";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

afterEach(() => setActiveStrings(en));

/** A local instant as ISO, from calendar parts. */
function local(y: number, m: number, d: number, h: number, min = 0): string {
  return new Date(y, m - 1, d, h, min).toISOString();
}

/** Wednesday 2026-09-02 12:00 local: "today" for every case below. */
const NOW = new Date(2026, 8, 2, 12, 0);
const MONDAY = local(2026, 8, 31, 9, 0); // 2026-08-31 is a Monday

describe("periodMinutes", () => {
  it("reads the server's 30m / 12h / 7d grammar and nothing else", () => {
    expect(periodMinutes("30m")).toBe(30);
    expect(periodMinutes("12h")).toBe(720);
    expect(periodMinutes("7d")).toBe(10080);
    expect(periodMinutes(" 1d ")).toBe(1440);
    expect(periodMinutes("0m")).toBeNull();
    expect(periodMinutes("1w")).toBeNull();
    expect(periodMinutes("daily")).toBeNull();
  });
});

describe("describeInstant", () => {
  it("names today and tomorrow, then dates, adding the year only when it differs", () => {
    expect(describeInstant(local(2026, 9, 2, 8, 0), "en", NOW)).toBe("today 08:00");
    expect(describeInstant(local(2026, 9, 3, 10, 0), "en", NOW)).toBe("tomorrow 10:00");
    expect(describeInstant(local(2026, 9, 5, 10, 0), "en", NOW)).toBe("Sep 5, 10:00");
    expect(describeInstant(local(2027, 1, 3, 10, 0), "en", NOW)).toBe("Jan 3, 2027, 10:00");
    setActiveStrings(en);
  });

  it("returns an unparsable instant as written", () => {
    expect(describeInstant("not a date", "en", NOW)).toBe("not a date");
  });
});

describe("describeSchedule", () => {
  const daily = { status: "active" as const, period: "1d", startAt: local(2026, 9, 1, 8, 0) };

  it("folds a daily period into the start time's wall clock, with the next trigger", () => {
    expect(describeSchedule({ ...daily, nextFireAt: local(2026, 9, 3, 8, 0) }, "en", NOW)).toBe(
      "Every day at 08:00 · Next: tomorrow 08:00",
    );
    // 24h is a day too.
    expect(describeSchedule({ ...daily, period: "24h" }, "en", NOW)).toBe("Every day at 08:00");
  });

  it("takes the wall clock from the next trigger, so the line cannot contradict itself", () => {
    // The server steps from start_at in fixed milliseconds, so a DST boundary moves a daily
    // task's wall clock by an hour; the summary follows the trigger it prints beside it.
    expect(
      describeSchedule(
        {
          status: "active",
          period: "1d",
          startAt: local(2026, 3, 1, 8, 0),
          nextFireAt: local(2026, 9, 3, 9, 0),
        },
        "en",
        NOW,
      ),
    ).toBe("Every day at 09:00 · Next: tomorrow 09:00");
  });

  it("names the weekday of a 7d period and counts other multi-day periods", () => {
    expect(describeSchedule({ status: "active", period: "7d", startAt: MONDAY }, "en", NOW)).toBe(
      "Every Monday at 09:00",
    );
    expect(describeSchedule({ status: "active", period: "3d", startAt: MONDAY }, "en", NOW)).toBe(
      "Every 3 days at 09:00",
    );
  });

  it("speaks sub-day periods as hours and minutes, without a wall clock", () => {
    expect(describeSchedule({ status: "active", period: "30m", startAt: MONDAY }, "en", NOW)).toBe(
      "Every 30 minutes",
    );
    expect(describeSchedule({ status: "active", period: "6h", startAt: MONDAY }, "en", NOW)).toBe(
      "Every 6 hours",
    );
    expect(describeSchedule({ status: "active", period: "1h", startAt: MONDAY }, "en", NOW)).toBe(
      "Every hour",
    );
    // 90 minutes is not a whole number of hours.
    expect(describeSchedule({ status: "active", period: "90m", startAt: MONDAY }, "en", NOW)).toBe(
      "Every 90 minutes",
    );
  });

  it("describes a one-off by its fire time and never repeats it as the next trigger", () => {
    const at = local(2026, 9, 3, 10, 0);
    expect(describeSchedule({ status: "active", startAt: at, nextFireAt: at }, "en", NOW)).toBe(
      "One-off · tomorrow 10:00",
    );
  });

  it("leads with a settled state and drops the next trigger from a paused task", () => {
    expect(describeSchedule({ ...daily, status: "expired" }, "en", NOW)).toBe(
      "Expired · Every day at 08:00",
    );
    expect(describeSchedule({ status: "done", startAt: local(2026, 9, 1, 10, 0) }, "en", NOW)).toBe(
      "Done · One-off · Sep 1, 10:00",
    );
    expect(describeSchedule({ ...daily, status: "missed" }, "en", NOW)).toBe(
      "Missed · Every day at 08:00",
    );
    expect(
      describeSchedule(
        { ...daily, status: "disabled", nextFireAt: local(2026, 9, 3, 8, 0) },
        "en",
        NOW,
      ),
    ).toBe("Every day at 08:00");
  });

  it("names an invalid file by its status alone", () => {
    expect(describeSchedule({ ...daily, status: "invalid" }, "en", NOW)).toBe("Invalid");
  });

  it("shows a period outside the grammar as written", () => {
    expect(describeSchedule({ ...daily, period: "fortnightly" }, "en", NOW)).toBe("fortnightly");
  });

  it("reads the English dictionary and locale together", () => {
    setActiveStrings(en);
    expect(describeSchedule({ ...daily, nextFireAt: local(2026, 9, 3, 8, 0) }, "en", NOW)).toBe(
      "Every day at 08:00 · Next: tomorrow 08:00",
    );
    expect(describeSchedule({ status: "active", period: "7d", startAt: MONDAY }, "en", NOW)).toBe(
      "Every Monday at 09:00",
    );
    expect(describeSchedule({ status: "active", period: "1h", startAt: MONDAY }, "en", NOW)).toBe(
      "Every hour",
    );
    expect(
      describeSchedule({ status: "expired", startAt: local(2026, 9, 1, 10, 0) }, "en", NOW),
    ).toBe("Expired · One-off · Sep 1, 10:00");
  });
});
