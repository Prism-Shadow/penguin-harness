/**
 * The fitting rule for the framed app: laid out at the app's window width, scaled down to the
 * column, never up.
 */
import { describe, expect, it } from "vitest";
import { APP_FRAME, PHONE_FRAME } from "../src/app/frame";
import { fitScale, fittedHeight } from "../src/lib/fit";

describe("the frames", () => {
  it("are the app's laptop window and an iPhone-class phone", () => {
    expect(APP_FRAME).toEqual({ width: 1280, height: 800 });
    expect(PHONE_FRAME.width).toBe(390);
  });
});

describe("fitScale", () => {
  it("shrinks the frame to a narrower column", () => {
    expect(fitScale(1280, 704)).toBeCloseTo(0.55, 5);
    expect(fitScale(956, 704)).toBeCloseTo(704 / 956, 10);
  });

  it("never scales up, and holds at 1 until the column has been measured", () => {
    expect(fitScale(956, 1200)).toBe(1);
    expect(fitScale(956, 956)).toBe(1);
    expect(fitScale(956, 0)).toBe(1);
    expect(fitScale(0, 704)).toBe(1);
  });

  it("gives the box the frame's height at that scale, rounded up so nothing is cut", () => {
    expect(fittedHeight(702, 0.55)).toBe(387);
    expect(fittedHeight(800, 0.5)).toBe(400);
    expect(fittedHeight(640, 1)).toBe(640);
  });
});
