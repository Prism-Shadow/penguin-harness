/**
 * The duotone bodies (icons/sets/duotone.ts) are filled, and a fill closes an open subpath on
 * its own with a straight line back to its start: an open stroke left in a body would paint a
 * wedge the line drawing does not have. So every body is path data made of closed subpaths only.
 */
import { describe, expect, it } from "vitest";
import { DUOTONE } from "../src/components/icons/sets";

describe("DUOTONE", () => {
  it("draws every body as closed subpaths only", () => {
    for (const [key, d] of Object.entries(DUOTONE)) {
      if (d === undefined) continue;
      expect(d, key).toMatch(/^[Mm][\d\s.,eE+\-MmZzLlHhVvCcSsQqTtAa]*$/);
      for (const subpath of d.split(/(?=[Mm])/)) expect(subpath, key).toMatch(/[Zz]\s*$/);
    }
  });
});
