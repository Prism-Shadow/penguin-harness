/**
 * Cost Center chart pure-function unit tests (chart-geom.ts): coordinate mapping, SVG path
 * assembly, Token bar chart horizontal layout (fixed 25px bar width / spacing ≥ bar width /
 * whether it scrolls horizontally), stacked-bar segment geometry and per-segment hit bands,
 * pie slice arcs, success rate. Component interaction isn't covered here (vitest runs in a
 * node environment, no DOM).
 *
 * Canvas width is "measured container pixels" (1 canvas unit = 1 CSS pixel), so each case
 * passes an explicit width; 640 was the original fixed canvas width, and reusing it as the
 * sample width also proves the coordinate / path math is unchanged (zero regression for the
 * cost line chart).
 */
import { describe, expect, it } from "vitest";
import {
  makeGeom,
  linePath,
  areaPath,
  sparseLabelIdx,
  autoLabelIdx,
  successRate,
  tokenBarLayout,
  barSegments,
  pieSlices,
  BAR_W,
  MIN_HIT_H,
  PAD_L,
  PAD_R,
} from "../src/features/usage/chart-geom";

describe("makeGeom", () => {
  it("x 取每格中点、y 以 max 为满格自上而下", () => {
    const g = makeGeom(2, 100, 640);
    // innerW=586, step=293; x=PAD_L(46)+step*i+step/2
    expect(g.w).toBe(640);
    expect(g.step).toBe(293);
    expect(g.x(0)).toBe(192.5);
    expect(g.x(1)).toBe(485.5);
    // innerH=168; y(0)=PAD_T(10)+168, y(max)=PAD_T
    expect(g.y(0)).toBe(178);
    expect(g.y(100)).toBe(10);
    expect(g.y(50)).toBe(94);
  });

  it("画布宽由调用方给（1 单位 = 1 像素）：内宽随之伸缩", () => {
    const g = makeGeom(30, 100, 1554);
    expect(g.innerW).toBe(1500);
    expect(g.step).toBe(50);
    expect(g.x(0)).toBe(71); // 46 + 0 + 25 (unchanged, kept for reference)
  });

  it("n=0 时 step 回退为整个内宽（不除零）", () => {
    expect(makeGeom(0, 1, 640).step).toBe(586);
  });
});

describe("linePath / areaPath", () => {
  const g = makeGeom(2, 100, 640);

  it("折线：M 起点 + 逐点 L（与旧成本折线一字不差）", () => {
    expect(linePath(g, [100, 0])).toBe("M192.5,10 L485.5,178");
  });

  it("面积：折线末端落到基线、回到起点闭合", () => {
    expect(areaPath(g, [100, 0])).toBe("M192.5,10 L485.5,178 L485.5,178 L192.5,178 Z");
  });

  it("空序列返回空串", () => {
    expect(areaPath(g, [])).toBe("");
  });
});

describe("tokenBarLayout", () => {
  /** Bar width is real pixels, so inner width = container width - left/right padding: a 990 container has inner width 936. */
  const inner = (containerW: number) => containerW - PAD_L - PAD_R;

  it("柱宽固定 25px：30 天在半格（495px）里塞不下 → 撑出超宽画布，横向滚动", () => {
    const l = tokenBarLayout(495, 30);
    expect(l.barW).toBe(25);
    expect(l.barW).toBe(BAR_W);
    // 30 slots x (25 bar + 25 gap) = 1500 > inner width 441 -> canvas = 46 + 1500 + 8
    expect(l.chartW).toBe(1554);
    expect(l.chartW).toBeGreaterThan(495);
    expect(l.scroll).toBe(true);
  });

  it("塞不下时柱间距 = 柱宽：每格 = 2×柱宽，柱居格中 → 柱间空白正好一个柱宽", () => {
    const l = tokenBarLayout(495, 30);
    const g = makeGeom(30, 1, l.chartW);
    expect(g.step).toBe(2 * l.barW);
    // Two adjacent bars: left bar's right edge = x(0)+barW/2, right bar's left edge = x(1)-barW/2
    const gap = g.x(1) - l.barW / 2 - (g.x(0) + l.barW / 2);
    expect(gap).toBeCloseTo(l.barW);
    // Half a gap is left on the first bar's left / last bar's right, so bars don't touch the axis or overflow the canvas
    expect(g.x(0) - l.barW / 2).toBeCloseTo(PAD_L + l.barW / 2);
    expect(g.x(29) + l.barW / 2).toBeCloseTo(l.chartW - PAD_R - l.barW / 2);
  });

  it("点数少：柱子**不撑宽**（25px 是固定值不是下限），富余空间全部让给柱间距", () => {
    const l = tokenBarLayout(990, 7);
    expect(l.barW).toBe(BAR_W); // the old implementation would stretch it to 936/14 = 66.86px
    expect(l.chartW).toBe(990); // the canvas still fills the container: the slack goes into the bar gaps, not the right edge
    expect(l.scroll).toBe(false);
    // Each slot = inner width / 7 = 133.7px: a 25px bar centered, with 108.7px of gap (>= bar width)
    const g = makeGeom(7, 1, l.chartW);
    expect(g.step).toBeCloseTo(inner(990) / 7);
    const gap = g.x(1) - l.barW / 2 - (g.x(0) + l.barW / 2);
    expect(gap).toBeCloseTo(inner(990) / 7 - BAR_W);
    expect(gap).toBeGreaterThan(BAR_W);
  });

  it("临界点：每格正好 50px 时铺满不滚动，再多一天就超宽 + 滚动（柱宽始终 25px）", () => {
    const exact = inner(990) / 50; // 18.72 days
    const fits = Math.floor(exact); // 18 days: inner width 936 >= 18x50 = 900
    expect(tokenBarLayout(990, fits)).toMatchObject({ barW: BAR_W, chartW: 990, scroll: false });
    expect(tokenBarLayout(990, fits + 1)).toMatchObject({ barW: BAR_W, scroll: true });
    expect(tokenBarLayout(990, fits + 1).chartW).toBe(PAD_L + 2 * BAR_W * 19 + PAD_R);
  });

  it("整行容器 + 少量日点：柱宽仍是 25px（旧实现在这里胖到 ~180px）", () => {
    const l = tokenBarLayout(990, 3);
    expect(l.barW).toBe(25);
    expect(l.chartW).toBe(990);
    expect(l.scroll).toBe(false);
  });
});

describe("autoLabelIdx", () => {
  it("每格够宽就逐日标（Token 柱图每格 ≥ 50px）", () => {
    expect(autoLabelIdx(30, 50)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(autoLabelIdx(7, 133)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("格窄时按需隔格标，不糊在一起", () => {
    expect(autoLabelIdx(30, 20)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
    expect(autoLabelIdx(30, 10)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(autoLabelIdx(0, 50)).toEqual([]);
  });
});

describe("barSegments", () => {
  // max=100, innerH=168: 1 unit of value = 1.68 canvas units; baseline y(0)=178.
  const g = makeGeom(30, 100, 640);

  it("自底向上 output → cacheWrite → cacheRead，三段严丝合缝、总高 = 当日总量", () => {
    const segs = barSegments(g, { cacheRead: 50, cacheWrite: 30, output: 20 });
    expect(segs.map((s) => s.key)).toEqual(["output", "cacheWrite", "cacheRead"]);
    // output 20 sits on the baseline: 178 - 20*1.68 = 144.4
    expect(segs[0]!.y).toBeCloseTo(144.4);
    expect(segs[0]!.h).toBeCloseTo(33.6);
    // cacheWrite 30 stacks on top of output; its top edge = cumulative 50 -> y(50)=94
    expect(segs[1]!.y).toBeCloseTo(94);
    expect(segs[1]!.h).toBeCloseTo(50.4);
    // cacheRead 50 caps the stack; its top edge = cumulative 100 -> y(100)=10
    expect(segs[2]!.y).toBeCloseTo(10);
    expect(segs[2]!.h).toBeCloseTo(84);
    // Segments connect seamlessly: the previous segment's top edge = the next segment's bottom edge
    expect(segs[0]!.y).toBeCloseTo(segs[1]!.y + segs[1]!.h);
    expect(segs[1]!.y).toBeCloseTo(segs[2]!.y + segs[2]!.h);
  });

  it("零值桶不出段（不画、也不该被 hover 到）；全零当日无段", () => {
    expect(barSegments(g, { cacheRead: 10, cacheWrite: 0, output: 5 }).map((s) => s.key)).toEqual([
      "output",
      "cacheRead",
    ]);
    expect(barSegments(g, { cacheRead: 0, cacheWrite: 0, output: 0 })).toEqual([]);
    // With only one bucket left: the lone segment's hit band = the whole bar
    const one = barSegments(g, { cacheRead: 4, cacheWrite: 0, output: 0 });
    expect(one.map((s) => s.key)).toEqual(["cacheRead"]);
    expect(one[0]!.hitH).toBeCloseTo(g.y(0) - g.y(4));
  });

  it("命中带铺满整根柱、互不重叠（自底向上首尾相接）", () => {
    const segs = barSegments(g, { cacheRead: 50, cacheWrite: 30, output: 20 });
    const base = g.y(0);
    const top = g.y(100);
    expect(segs[0]!.hitY + segs[0]!.hitH).toBeCloseTo(base); // the bottommost segment sits on the baseline
    expect(segs[0]!.hitY).toBeCloseTo(segs[1]!.hitY + segs[1]!.hitH);
    expect(segs[1]!.hitY).toBeCloseTo(segs[2]!.hitY + segs[2]!.hitH);
    expect(segs[2]!.hitY).toBeCloseTo(top); // the topmost segment caps at the bar's top
    expect(segs.reduce((s, x) => s + x.hitH, 0)).toBeCloseTo(base - top);
  });

  it("亚像素的小段：命中带抬到下限（否则 output 常不足 1%、根本 hover 不到），大段等比让出空间", () => {
    // Realistic shape: cacheRead is 99%, output only 0.5% -> visual height under 1 unit.
    const segs = barSegments(g, { cacheRead: 99, cacheWrite: 0.5, output: 0.5 });
    const out = segs.find((s) => s.key === "output")!;
    const read = segs.find((s) => s.key === "cacheRead")!;
    expect(out.h).toBeLessThan(1); // the visual rectangle still strictly follows the value (no inflated bar height)
    expect(out.hitH).toBe(MIN_HIT_H); // the hit band is raised to the floor
    expect(read.hitH).toBeCloseTo(g.y(0) - g.y(100) - 2 * MIN_HIT_H); // the large segment yields space
    expect(segs.reduce((s, x) => s + x.hitH, 0)).toBeCloseTo(g.y(0) - g.y(100));
  });

  it("整根柱都矮于 k*minHit 时命中带等分（谁也挤不走谁）", () => {
    const segs = barSegments(g, { cacheRead: 2, cacheWrite: 2, output: 2 });
    const total = g.y(0) - g.y(6); // 6 * 1.68 = 10.08 < 3 * 8
    for (const s of segs) expect(s.hitH).toBeCloseTo(total / 3);
  });
});

describe("pieSlices", () => {
  it("按值占比自 12 点顺时针排布：半圆的 arc 起于顶、止于底", () => {
    const [a, b] = pieSlices([1, 1], 50, 50, 40);
    expect(a!.frac).toBe(0.5);
    expect(a!.start).toBe(0);
    expect(a!.end).toBeCloseTo(Math.PI);
    // First slice: center -> 12 o'clock -> clockwise (sweep=1) to 6 o'clock; exactly a
    // half-circle, so large-arc=0
    expect(a!.path).toBe("M50,50 L50,10 A40,40 0 0 1 50,90 Z");
    // The second slice continues to finish the bottom half
    expect(b!.path).toBe("M50,50 L50,90 A40,40 0 0 1 50,10 Z");
  });

  it("跨过半圆的扇区置 large-arc=1", () => {
    const [big] = pieSlices([3, 1], 50, 50, 40);
    expect(big!.frac).toBe(0.75);
    expect(big!.path).toBe("M50,50 L50,10 A40,40 0 1 1 10,50 Z");
  });

  it("单个类别独占 100% 时退化为整圆（两段半圆 arc，A 指令首尾重合画不出东西）", () => {
    const [only] = pieSlices([7], 50, 50, 40);
    expect(only!.frac).toBe(1);
    expect(only!.path).toBe("M50,10 A40,40 0 1 1 50,90 A40,40 0 1 1 50,10 Z");
  });

  it("非正值不出扇区（保留原下标供调用方回查名称/配色）；总量 ≤ 0 时为空", () => {
    const slices = pieSlices([5, 0, 5], 50, 50, 40);
    expect(slices.map((s) => s.index)).toEqual([0, 2]);
    expect(slices.map((s) => s.frac)).toEqual([0.5, 0.5]);
    expect(pieSlices([], 50, 50, 40)).toEqual([]);
    expect(pieSlices([0, 0], 50, 50, 40)).toEqual([]);
  });
});

describe("sparseLabelIdx", () => {
  it("首/中/尾稀疏标注", () => {
    expect(sparseLabelIdx(0)).toEqual([]);
    expect(sparseLabelIdx(1)).toEqual([0]);
    expect(sparseLabelIdx(2)).toEqual([0, 1]);
    expect(sparseLabelIdx(5)).toEqual([0, 2, 4]);
    expect(sparseLabelIdx(30)).toEqual([0, 14, 29]);
  });
});

describe("successRate", () => {
  it("completed/total，无请求视为 1", () => {
    expect(successRate(99, 100)).toBeCloseTo(0.99);
    expect(successRate(5, 10)).toBe(0.5);
    expect(successRate(0, 0)).toBe(1);
  });
});
