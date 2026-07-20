/**
 * Speed-test tone thresholds: TTFT (< 1s green, <= 3s yellow, beyond red) and TPS
 * (>= 40 tok/s green, >= 15 yellow, below red) — the card badge colors.
 */
import { describe, expect, it } from "vitest";
import { tpsTone, ttftTone } from "../src/features/models/speed-test";

describe("speed-test tones", () => {
  it("grades TTFT boundaries", () => {
    expect(ttftTone(120)).toBe("green");
    expect(ttftTone(999)).toBe("green");
    expect(ttftTone(1000)).toBe("yellow");
    expect(ttftTone(3000)).toBe("yellow");
    expect(ttftTone(3001)).toBe("red");
  });

  it("grades TPS boundaries", () => {
    expect(tpsTone(80)).toBe("green");
    expect(tpsTone(40)).toBe("green");
    expect(tpsTone(39.9)).toBe("yellow");
    expect(tpsTone(15)).toBe("yellow");
    expect(tpsTone(14.9)).toBe("red");
  });
});
