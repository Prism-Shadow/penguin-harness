import { describe, expect, it } from "vitest";
import { nearestSnap, project, rubberband } from "../src/lib/sheet-physics";

describe("project", () => {
  it("zero velocity, zero displacement", () => {
    expect(project(0)).toBe(0);
  });

  it("matches the exponential-decay projection formula (1000px/s @ 0.998 ≈ 499px)", () => {
    expect(project(1000, 0.998)).toBeCloseTo(499, 0);
    expect(project(-1000, 0.998)).toBeCloseTo(-499, 0);
  });

  it("a lower decay rate projects shorter (0.99 stops faster than 0.998)", () => {
    expect(Math.abs(project(1000, 0.99))).toBeLessThan(Math.abs(project(1000, 0.998)));
  });
});

describe("rubberband", () => {
  it("more overshoot shows more, with diminishing increments (progressive damping)", () => {
    const d = 800;
    const r50 = rubberband(50, d);
    const r100 = rubberband(100, d);
    const r150 = rubberband(150, d);
    expect(r100).toBeGreaterThan(r50);
    expect(r150).toBeGreaterThan(r100);
    expect(r100 - r50).toBeGreaterThan(r150 - r100);
  });

  it("the displayed overshoot is always less than the actual overshoot", () => {
    expect(rubberband(100, 800)).toBeLessThan(100);
    expect(rubberband(1, 800)).toBeLessThan(1);
  });
});

describe("nearestSnap", () => {
  it("snaps to the nearest point", () => {
    const snaps = [0, 300, 800] as const;
    expect(nearestSnap(120, snaps)).toBe(0);
    expect(nearestSnap(180, snaps)).toBe(300);
    expect(nearestSnap(540, snaps)).toBe(300);
    expect(nearestSnap(700, snaps)).toBe(800);
  });

  it("exactly at the midpoint takes the earlier candidate", () => {
    expect(nearestSnap(150, [0, 300])).toBe(0);
  });
});
