/**
 * The speed a download source's button shows (pages/download.tsx).
 *
 * - Speeds under a megabyte a second print as whole KB/s, at least 1; faster ones as MB/s with
 *   one decimal.
 * - A speed whose whole KB/s figure rounds up to 1024 carries into MB/s.
 */
import { describe, expect, it } from "vitest";
import { formatSpeed } from "../src/pages/download";

const KB = 1024;
const MB = 1024 * 1024;

describe("formatSpeed", () => {
  it("prints KB/s under a megabyte a second and MB/s from there", () => {
    expect(formatSpeed(100)).toBe("1 KB/s");
    expect(formatSpeed(300 * KB)).toBe("300 KB/s");
    expect(formatSpeed(2.5 * MB)).toBe("2.5 MB/s");
  });

  it("carries a speed that rounds up to 1024 KB/s into MB/s", () => {
    // Picking the unit from the raw value would print 1024 KB/s.
    expect(formatSpeed(1023.6 * KB)).toBe("1.0 MB/s");
    // Just below the carry the unit is unchanged.
    expect(formatSpeed(1023.4 * KB)).toBe("1023 KB/s");
  });
});
