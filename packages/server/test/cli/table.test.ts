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
