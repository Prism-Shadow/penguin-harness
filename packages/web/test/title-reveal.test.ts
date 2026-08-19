/**
 * title-reveal.ts unit tests: the pure math behind the sidebar's truncated-title
 * scroll reveal (#309). Distance: only a real overflow (beyond the 1px subpixel
 * tolerance) counts — it drives both the `title` tooltip and the scroll, so "fits"
 * must be exactly 0. Duration: proportional to the distance (constant reading
 * speed), clamped between a floor (a sub-350ms hop reads as a glitch) and a
 * ceiling (a huge title speeds up instead of holding the hover hostage), and 0
 * when there is nothing to scroll.
 */
import { describe, expect, it } from "vitest";
import {
  OVERFLOW_TOLERANCE_PX,
  REVEAL_MAX_MS,
  REVEAL_MIN_MS,
  REVEAL_SPEED_PX_PER_S,
  revealDistancePx,
  revealDurationMs,
} from "../src/lib/title-reveal";

describe("revealDistancePx", () => {
  it("reports 0 when the text fits", () => {
    expect(revealDistancePx(180, 200)).toBe(0);
    expect(revealDistancePx(200, 200)).toBe(0);
  });

  it("treats the 1px subpixel rounding artifact as fitting", () => {
    expect(revealDistancePx(200 + OVERFLOW_TOLERANCE_PX, 200)).toBe(0);
  });

  it("reports the full overflow once past the tolerance", () => {
    expect(revealDistancePx(202, 200)).toBe(2);
    expect(revealDistancePx(350, 200)).toBe(150);
  });
});

describe("revealDurationMs", () => {
  it("is 0 when there is nothing to scroll", () => {
    expect(revealDurationMs(0)).toBe(0);
    expect(revealDurationMs(-5)).toBe(0);
  });

  it("clamps a tiny overflow up to the floor", () => {
    // 2px at 60px/s would be ~33ms — far below the floor.
    expect(revealDurationMs(2)).toBe(REVEAL_MIN_MS);
  });

  it("is proportional to the distance between the clamps", () => {
    // Exactly one second's worth of travel.
    expect(revealDurationMs(REVEAL_SPEED_PX_PER_S)).toBe(1000);
    // Double the distance, double the duration.
    expect(revealDurationMs(REVEAL_SPEED_PX_PER_S * 2)).toBe(2000);
  });

  it("clamps a huge overflow down to the ceiling", () => {
    // 1500px at 60px/s would be 25s — capped so the reveal stays usable.
    expect(revealDurationMs(1500)).toBe(REVEAL_MAX_MS);
  });

  it("rounds to whole milliseconds", () => {
    // 100px at 60px/s = 1666.66…ms.
    expect(revealDurationMs(100)).toBe(1667);
  });
});
