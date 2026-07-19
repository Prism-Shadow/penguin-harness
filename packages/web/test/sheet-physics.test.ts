import { describe, expect, it } from "vitest";
import { nearestSnap, project, rubberband } from "../src/lib/sheet-physics";

describe("project", () => {
  it("零速度零位移", () => {
    expect(project(0)).toBe(0);
  });

  it("符合指数衰减投影公式（1000px/s @ 0.998 ≈ 499px）", () => {
    expect(project(1000, 0.998)).toBeCloseTo(499, 0);
    expect(project(-1000, 0.998)).toBeCloseTo(-499, 0);
  });

  it("减速率越低，投影越短（0.99 比 0.998 更快停下）", () => {
    expect(Math.abs(project(1000, 0.99))).toBeLessThan(Math.abs(project(1000, 0.998)));
  });
});

describe("rubberband", () => {
  it("越界越多显示越多，但增量递减（渐进阻尼）", () => {
    const d = 800;
    const r50 = rubberband(50, d);
    const r100 = rubberband(100, d);
    const r150 = rubberband(150, d);
    expect(r100).toBeGreaterThan(r50);
    expect(r150).toBeGreaterThan(r100);
    expect(r100 - r50).toBeGreaterThan(r150 - r100);
  });

  it("显示越界量恒小于实际越界量", () => {
    expect(rubberband(100, 800)).toBeLessThan(100);
    expect(rubberband(1, 800)).toBeLessThan(1);
  });
});

describe("nearestSnap", () => {
  it("就近吸附", () => {
    const snaps = [0, 300, 800] as const;
    expect(nearestSnap(120, snaps)).toBe(0);
    expect(nearestSnap(180, snaps)).toBe(300);
    expect(nearestSnap(540, snaps)).toBe(300);
    expect(nearestSnap(700, snaps)).toBe(800);
  });

  it("恰在中点时取先出现的候选", () => {
    expect(nearestSnap(150, [0, 300])).toBe(0);
  });
});
