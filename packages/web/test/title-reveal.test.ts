/**
 * The sidebar's truncated-title reveal (lib/title-reveal.ts): how far and how long a title
 * that does not fit scrolls, and which of the scroll and the tooltip reaches its tail.
 *
 * - A title that fits, or overflows by no more than the 1px subpixel tolerance, has nothing
 *   to reveal; past the tolerance the whole overflow is revealed.
 * - The scroll runs at a constant reading speed, clamped between a floor and a ceiling, in
 *   whole milliseconds, and takes no time when there is nothing to scroll.
 * - A title that fits discloses nothing; an overflowing one scrolls where the scroll is
 *   offered and motion is allowed, and falls back to the tooltip otherwise.
 */
import { describe, expect, it } from "vitest";
import {
  OVERFLOW_TOLERANCE_PX,
  REVEAL_MAX_MS,
  REVEAL_MIN_MS,
  REVEAL_SPEED_PX_PER_S,
  revealDistancePx,
  revealDurationMs,
  titleDisclosure,
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

describe("titleDisclosure", () => {
  it("discloses nothing for a title that fits", () => {
    for (const scrollReveal of [false, true]) {
      for (const reducedMotion of [false, true]) {
        expect(titleDisclosure({ overflowing: false, scrollReveal, reducedMotion })).toBe("none");
      }
    }
  });

  it("gives a scrolling row the scroll alone", () => {
    // The pair is what #570 reported: a tooltip raised over a row that is already scrolling
    // repeats the text sliding past under the pointer.
    expect(titleDisclosure({ overflowing: true, scrollReveal: true, reducedMotion: false })).toBe(
      "scroll",
    );
  });

  it("falls back to the tooltip once reduced motion stops the scroll", () => {
    // styles.css disables the keyframes outright there, so the scroll is not an option and
    // the tooltip is the only thing left that reaches the tail with a pointer.
    expect(titleDisclosure({ overflowing: true, scrollReveal: true, reducedMotion: true })).toBe(
      "tooltip",
    );
  });

  it("leaves a caller that never asked for the scroll with its tooltip", () => {
    for (const reducedMotion of [false, true]) {
      expect(titleDisclosure({ overflowing: true, scrollReveal: false, reducedMotion })).toBe(
        "tooltip",
      );
    }
  });
});
