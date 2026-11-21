/**
 * `relativeTime`, the LAST column of `session ls`: past two weeks it names the reader's own
 * calendar day, the one `--days` counts in, not the UTC date of the stored instant. The zone is
 * switched per case: on a UTC runner a local-vs-UTC slip would be invisible.
 */
import { afterEach, describe, expect, it } from "vitest";
import { relativeTime } from "../../src/cli/table.js";
import { switchTimeZone } from "../helpers/time-zone.js";

const NOW = new Date("2026-10-30T04:00:00.000Z");

describe("relativeTime for a row older than two weeks", () => {
  let restoreZone = (): void => {};
  afterEach(() => restoreZone());

  it("names the local day east of UTC", () => {
    restoreZone = switchTimeZone("Asia/Shanghai");
    // 03:00 on the 11th in Shanghai is still the 10th in UTC.
    expect(relativeTime("2026-10-10T19:00:00.000Z", NOW)).toBe("2026-10-11");
  });

  it("names the local day west of UTC", () => {
    restoreZone = switchTimeZone("America/Los_Angeles");
    // 20:00 on the 10th in Los Angeles is already the 11th in UTC.
    expect(relativeTime("2026-10-11T03:00:00.000Z", NOW)).toBe("2026-10-10");
  });
});

describe("relativeTime for a future timestamp (clock skew)", () => {
  let restoreZone = (): void => {};
  afterEach(() => restoreZone());

  it("formats a future timestamp as the local calendar day instead of 'now'", () => {
    restoreZone = switchTimeZone("Asia/Shanghai");
    // Even 500ms ahead of `now` is future rather than "now"; 19:00Z on Nov 5 is Nov 6 in Shanghai.
    expect(relativeTime("2026-10-30T04:00:00.500Z", NOW)).toBe("2026-10-30");
    expect(relativeTime("2026-11-05T19:00:00.000Z", NOW)).toBe("2026-11-06");
  });

  it("uses the caller's local timezone west of UTC for future rows", () => {
    restoreZone = switchTimeZone("America/Los_Angeles");
    // 2026-10-30T04:00:00.500Z is still 21:00 on Oct 29 in Los Angeles.
    expect(relativeTime("2026-10-30T04:00:00.500Z", NOW)).toBe("2026-10-29");
    expect(relativeTime("2026-11-06T03:00:00.000Z", NOW)).toBe("2026-11-05");
  });
});

describe("relativeTime units and boundaries", () => {
  let restoreZone = (): void => {};
  afterEach(() => restoreZone());

  it("formats current, minutes, hours, days, 14d cutoff, and unparseable strings", () => {
    restoreZone = switchTimeZone("UTC");
    expect(relativeTime("2026-10-30T04:00:00.000Z", NOW)).toBe("now");
    expect(relativeTime("2026-10-30T03:59:01.000Z", NOW)).toBe("now");
    expect(relativeTime("2026-10-30T03:59:00.000Z", NOW)).toBe("1m");
    expect(relativeTime("2026-10-30T03:00:00.000Z", NOW)).toBe("1h");
    expect(relativeTime("2026-10-17T04:00:00.000Z", NOW)).toBe("13d");
    expect(relativeTime("2026-10-16T04:00:00.000Z", NOW)).toBe("2026-10-16");
    expect(relativeTime("not-a-date", NOW)).toBe("not-a-date");
  });
});
