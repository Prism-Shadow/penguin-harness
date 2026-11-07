/**
 * `relativeTime`, the LAST column of `session ls`: the short forms up to two weeks, then the
 * reader's own calendar day, the one `--days` counts in. The zone is pinned per case: on a UTC
 * runner a local-vs-UTC slip would be invisible.
 */
import { describe, expect, it } from "vitest";
import { relativeTime } from "../src/table.js";

/** Run `fn` with `process.env.TZ` set to `tz`; Node re-reads it on every Date call. */
function withTimeZone(tz: string, fn: () => void): void {
  const real = process.env.TZ;
  process.env.TZ = tz;
  try {
    fn();
  } finally {
    if (real === undefined) delete process.env.TZ;
    else process.env.TZ = real;
  }
}

const NOW = new Date("2026-10-30T04:00:00.000Z");

describe("relativeTime", () => {
  it("keeps the short forms under two weeks", () => {
    expect(relativeTime("2026-10-30T03:59:30.000Z", NOW)).toBe("now");
    expect(relativeTime("2026-10-30T03:55:00.000Z", NOW)).toBe("5m");
    expect(relativeTime("2026-10-30T01:00:00.000Z", NOW)).toBe("3h");
    expect(relativeTime("2026-10-28T04:00:00.000Z", NOW)).toBe("2d");
    expect(relativeTime("not a date", NOW)).toBe("not a date");
  });

  it("names an older row's local day east of UTC", () => {
    // 03:00 on the 11th in Shanghai is still the 10th in UTC.
    withTimeZone("Asia/Shanghai", () => {
      expect(relativeTime("2026-10-10T19:00:00.000Z", NOW)).toBe("2026-10-11");
    });
  });

  it("names an older row's local day west of UTC", () => {
    // 20:00 on the 10th in Los Angeles is already the 11th in UTC.
    withTimeZone("America/Los_Angeles", () => {
      expect(relativeTime("2026-10-11T03:00:00.000Z", NOW)).toBe("2026-10-10");
    });
  });

  it("is the UTC day in UTC", () => {
    withTimeZone("UTC", () => {
      expect(relativeTime("2026-10-10T19:00:00.000Z", NOW)).toBe("2026-10-10");
    });
  });
});
