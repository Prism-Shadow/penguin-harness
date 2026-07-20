import { describe, expect, it } from "vitest";
import { SPRING_DEFAULT, SPRING_MOMENTUM, isSettled, stepSpring } from "../src/lib/spring";
import type { SpringConfig } from "../src/lib/spring";

/** Runs a number of frames at 16ms per frame, returning the final state and path. */
function run(from: number, target: number, config: SpringConfig, frames = 240) {
  let x = from;
  let v = 0;
  const path: number[] = [];
  for (let i = 0; i < frames; i++) {
    [x, v] = stepSpring(x, v, target, config, 16);
    path.push(x);
  }
  return { x, v, path };
}

describe("stepSpring", () => {
  it("converges to the target", () => {
    const { x, v } = run(600, 0, SPRING_DEFAULT);
    expect(Math.abs(x)).toBeLessThan(0.5);
    expect(Math.abs(v)).toBeLessThan(5);
  });

  it("critical damping (damping=1) from rest does not overshoot", () => {
    const { path } = run(600, 0, SPRING_DEFAULT);
    for (const p of path) expect(p).toBeGreaterThanOrEqual(-0.5);
  });

  it("underdamped (damping=0.8) overshoots then swings back", () => {
    const { path } = run(600, 0, SPRING_MOMENTUM);
    expect(Math.min(...path)).toBeLessThan(-1);
  });

  it("an initial velocity away from the target follows the velocity first, then returns (velocity-handoff semantics)", () => {
    let x = 100;
    let v = 800; // moving away from target 0
    [x, v] = stepSpring(x, v, 0, SPRING_MOMENTUM, 16);
    expect(x).toBeGreaterThan(100);
    for (let i = 0; i < 240; i++) [x, v] = stepSpring(x, v, 0, SPRING_MOMENTUM, 16);
    expect(Math.abs(x)).toBeLessThan(0.5);
  });

  it("huge frame gaps (background tab resume) do not blow up numerically", () => {
    let x = 600;
    let v = 0;
    for (let i = 0; i < 60; i++) [x, v] = stepSpring(x, v, 0, SPRING_MOMENTUM, 500);
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(x)).toBeLessThan(1);
  });
});

describe("isSettled", () => {
  it("dual thresholds on position and velocity", () => {
    expect(isSettled(0.4, 4, 0)).toBe(true);
    expect(isSettled(1, 0, 0)).toBe(false);
    expect(isSettled(0, 10, 0)).toBe(false);
  });
});
