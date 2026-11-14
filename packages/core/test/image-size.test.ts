/**
 * formatSize, the size `read_file` reports for an image (environment/tools/image-source.ts).
 *
 * - Bytes under 1024 print as bytes; larger sizes print in kB or MB with one decimal.
 * - A size whose one-decimal kB figure rounds up to 1024 carries into MB.
 */
import { describe, expect, it } from "vitest";
import { formatSize } from "../src/environment/tools/image-source.js";

describe("formatSize", () => {
  it("prints bytes, kilobytes and megabytes", () => {
    expect(formatSize(812)).toBe("812 B");
    expect(formatSize(3481)).toBe("3.4 kB");
    expect(formatSize(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("carries a size that rounds up to 1024 kB into MB", () => {
    // Picking the unit from the raw value would print 1024.0 kB.
    expect(formatSize(1024 * 1024 - 6)).toBe("1.0 MB");
    // Just below the carry the unit is unchanged.
    expect(formatSize(1024 * 1024 - 60)).toBe("1023.9 kB");
  });
});
