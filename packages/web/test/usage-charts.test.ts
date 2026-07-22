/**
 * Cost Center chart pure-function unit tests (chart-geom.ts): coordinate mapping, SVG path
 * assembly, Token bar chart horizontal layout (fixed 25px bar width / spacing ≥ bar width /
 * whether it scrolls horizontally), stacked-bar segment geometry and per-segment hit bands,
 * pie slice arcs, success rate, hover-bubble placement (pointer lower-right, flipping at
 * the edges; the cache hit rate shown in the cacheRead bubble is lib/format's shared
 * cacheHitRate, tested in format.test.ts). Component interaction isn't covered here
 * (vitest runs in a node environment, no DOM).
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
  bubblePosition,
  tokenBarLayout,
  barSegments,
  pieSlices,
  BAR_W,
  BUBBLE_OFFSET,
  CHART_H,
  MIN_HIT_H,
  PAD_L,
  PAD_R,
} from "../src/features/usage/chart-geom";

describe("makeGeom", () => {
  it("x takes each slot's midpoint; y runs top-down with max as full scale", () => {
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

  it("canvas width comes from the caller (1 unit = 1 pixel): inner width scales with it", () => {
    const g = makeGeom(30, 100, 1554);
    expect(g.innerW).toBe(1500);
    expect(g.step).toBe(50);
    expect(g.x(0)).toBe(71); // 46 + 0 + 25 (unchanged, kept for reference)
  });

  it("step falls back to the whole inner width when n=0 (no division by zero)", () => {
    expect(makeGeom(0, 1, 640).step).toBe(586);
  });
});

describe("linePath / areaPath", () => {
  const g = makeGeom(2, 100, 640);

  it("line: M start + L per point (byte-identical to the old cost line)", () => {
    expect(linePath(g, [100, 0])).toBe("M192.5,10 L485.5,178");
  });

  it("area: the line's end drops to the baseline and closes back at the start", () => {
    expect(areaPath(g, [100, 0])).toBe("M192.5,10 L485.5,178 L485.5,178 L192.5,178 Z");
  });

  it("an empty series returns an empty string", () => {
    expect(areaPath(g, [])).toBe("");
  });
});

describe("tokenBarLayout", () => {
  /** Bar width is real pixels, so inner width = container width - left/right padding: a 990 container has inner width 936. */
  const inner = (containerW: number) => containerW - PAD_L - PAD_R;

  it("fixed 25px bar width: 30 days do not fit a half row (495px) → an extra-wide canvas with horizontal scrolling", () => {
    const l = tokenBarLayout(495, 30);
    expect(l.barW).toBe(25);
    expect(l.barW).toBe(BAR_W);
    // 30 slots x (25 bar + 25 gap) = 1500 > inner width 441 -> canvas = 46 + 1500 + 8
    expect(l.chartW).toBe(1554);
    expect(l.chartW).toBeGreaterThan(495);
    expect(l.scroll).toBe(true);
  });

  it("when they do not fit, bar gap = bar width: each slot = 2× bar width with the bar centered → exactly one bar width of space between bars", () => {
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

  it("few points: bars do **not** widen (25px is fixed, not a floor); all slack goes into the gaps", () => {
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

  it("boundary: exactly 50px per slot fills without scrolling; one more day means extra width + scrolling (bar width stays 25px)", () => {
    const exact = inner(990) / 50; // 18.72 days
    const fits = Math.floor(exact); // 18 days: inner width 936 >= 18x50 = 900
    expect(tokenBarLayout(990, fits)).toMatchObject({ barW: BAR_W, chartW: 990, scroll: false });
    expect(tokenBarLayout(990, fits + 1)).toMatchObject({ barW: BAR_W, scroll: true });
    expect(tokenBarLayout(990, fits + 1).chartW).toBe(PAD_L + 2 * BAR_W * 19 + PAD_R);
  });

  it("full-row container + few day points: bar width stays 25px (the old implementation fattened to ~180px here)", () => {
    const l = tokenBarLayout(990, 3);
    expect(l.barW).toBe(25);
    expect(l.chartW).toBe(990);
    expect(l.scroll).toBe(false);
  });
});

describe("autoLabelIdx", () => {
  it("labels every day when slots are wide enough (Token bar chart slots ≥ 50px)", () => {
    expect(autoLabelIdx(30, 50)).toEqual(Array.from({ length: 30 }, (_, i) => i));
    expect(autoLabelIdx(7, 133)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("narrow slots label every nth as needed, without smearing together", () => {
    expect(autoLabelIdx(30, 20)).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28]);
    expect(autoLabelIdx(30, 10)).toEqual([0, 4, 8, 12, 16, 20, 24, 28]);
    expect(autoLabelIdx(0, 50)).toEqual([]);
  });
});

describe("barSegments", () => {
  // max=100, innerH=168: 1 unit of value = 1.68 canvas units; baseline y(0)=178.
  const g = makeGeom(30, 100, 640);

  it("bottom-up output → cacheWrite → cacheRead: three seamless segments whose total height = the day's total", () => {
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

  it("zero-value buckets produce no segment (not drawn, not hoverable); an all-zero day has none", () => {
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

  it("hit bands cover the whole bar without overlapping (bottom-up, end to end)", () => {
    const segs = barSegments(g, { cacheRead: 50, cacheWrite: 30, output: 20 });
    const base = g.y(0);
    const top = g.y(100);
    expect(segs[0]!.hitY + segs[0]!.hitH).toBeCloseTo(base); // the bottommost segment sits on the baseline
    expect(segs[0]!.hitY).toBeCloseTo(segs[1]!.hitY + segs[1]!.hitH);
    expect(segs[1]!.hitY).toBeCloseTo(segs[2]!.hitY + segs[2]!.hitH);
    expect(segs[2]!.hitY).toBeCloseTo(top); // the topmost segment caps at the bar's top
    expect(segs.reduce((s, x) => s + x.hitH, 0)).toBeCloseTo(base - top);
  });

  it("sub-pixel small segments: the hit band is raised to the floor (output is often under 1% and otherwise unhoverable); large segments yield space proportionally", () => {
    // Realistic shape: cacheRead is 99%, output only 0.5% -> visual height under 1 unit.
    const segs = barSegments(g, { cacheRead: 99, cacheWrite: 0.5, output: 0.5 });
    const out = segs.find((s) => s.key === "output")!;
    const read = segs.find((s) => s.key === "cacheRead")!;
    expect(out.h).toBeLessThan(1); // the visual rectangle still strictly follows the value (no inflated bar height)
    expect(out.hitH).toBe(MIN_HIT_H); // the hit band is raised to the floor
    expect(read.hitH).toBeCloseTo(g.y(0) - g.y(100) - 2 * MIN_HIT_H); // the large segment yields space
    expect(segs.reduce((s, x) => s + x.hitH, 0)).toBeCloseTo(g.y(0) - g.y(100));
  });

  it("when the whole bar is shorter than k*minHit, hit bands split evenly (nobody squeezes anybody out)", () => {
    const segs = barSegments(g, { cacheRead: 2, cacheWrite: 2, output: 2 });
    const total = g.y(0) - g.y(6); // 6 * 1.68 = 10.08 < 3 * 8
    for (const s of segs) expect(s.hitH).toBeCloseTo(total / 3);
  });
});

describe("pieSlices", () => {
  it("laid out clockwise from 12 o'clock by value share: a half-circle arc starts at the top and ends at the bottom", () => {
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

  it("slices spanning more than a half circle set large-arc=1", () => {
    const [big] = pieSlices([3, 1], 50, 50, 40);
    expect(big!.frac).toBe(0.75);
    expect(big!.path).toBe("M50,50 L50,10 A40,40 0 1 1 10,50 Z");
  });

  it("a single category at 100% degenerates to a full circle (two half-circle arcs; an A command with coincident endpoints draws nothing)", () => {
    const [only] = pieSlices([7], 50, 50, 40);
    expect(only!.frac).toBe(1);
    expect(only!.path).toBe("M50,10 A40,40 0 1 1 50,90 A40,40 0 1 1 50,10 Z");
  });

  it("non-positive values produce no slice (original indexes kept so callers can look up names/colors); empty when the total ≤ 0", () => {
    const slices = pieSlices([5, 0, 5], 50, 50, 40);
    expect(slices.map((s) => s.index)).toEqual([0, 2]);
    expect(slices.map((s) => s.frac)).toEqual([0.5, 0.5]);
    expect(pieSlices([], 50, 50, 40)).toEqual([]);
    expect(pieSlices([0, 0], 50, 50, 40)).toEqual([]);
  });
});

describe("sparseLabelIdx", () => {
  it("sparse first/middle/last labeling", () => {
    expect(sparseLabelIdx(0)).toEqual([]);
    expect(sparseLabelIdx(1)).toEqual([0]);
    expect(sparseLabelIdx(2)).toEqual([0, 1]);
    expect(sparseLabelIdx(5)).toEqual([0, 2, 4]);
    expect(sparseLabelIdx(30)).toEqual([0, 14, 29]);
  });
});

describe("successRate", () => {
  it("completed/total; no requests counts as 1", () => {
    expect(successRate(99, 100)).toBeCloseTo(0.99);
    expect(successRate(5, 10)).toBe(0.5);
    expect(successRate(0, 0)).toBe(1);
  });
});

describe("bubblePosition", () => {
  // A 640px canvas that fits its card, not scrolled: the visible window is the whole canvas.
  const view = { left: 0, right: 640, bottom: CHART_H };
  const BW = 160;
  const BH = 48;

  it("default: the bubble hangs at the pointer's lower-right, offset on both axes", () => {
    expect(bubblePosition(100, 50, BW, BH, view)).toEqual({
      left: 100 + BUBBLE_OFFSET,
      top: 50 + BUBBLE_OFFSET,
    });
  });

  it("right edge: flips to the pointer's lower-left (clamping would slide it back under the pointer)", () => {
    const pos = bubblePosition(600, 50, BW, BH, view);
    expect(pos).toEqual({ left: 600 - BUBBLE_OFFSET - BW, top: 50 + BUBBLE_OFFSET });
    expect(pos.left + BW).toBeLessThanOrEqual(view.right); // fully inside the window
    expect(pos.left + BW).toBeLessThanOrEqual(600 - BUBBLE_OFFSET); // and clear of the pointer
  });

  it("bottom edge: flips above the pointer", () => {
    expect(bubblePosition(100, 190, BW, BH, view)).toEqual({
      left: 100 + BUBBLE_OFFSET,
      top: 190 - BUBBLE_OFFSET - BH,
    });
  });

  it("bottom-right corner: flips on both axes to the pointer's upper-left", () => {
    expect(bubblePosition(630, 195, BW, BH, view)).toEqual({
      left: 630 - BUBBLE_OFFSET - BW,
      top: 195 - BUBBLE_OFFSET - BH,
    });
  });

  it("an exact fit against the edge does not flip", () => {
    const px = view.right - BUBBLE_OFFSET - BW; // left + BW lands exactly on view.right
    expect(bubblePosition(px, 50, BW, BH, view).left).toBe(px + BUBBLE_OFFSET);
  });

  it("scrolled Token bar canvas: flips against the *visible* window, not the full canvas", () => {
    // 1554px canvas in a 495px card scrolled to the far right: visible [1059, 1554].
    const v = { left: 1059, right: 1554, bottom: CHART_H };
    // Mid-window: normal lower-right placement (canvas coordinates, not window-relative).
    expect(bubblePosition(1100, 50, BW, BH, v)).toEqual({ left: 1112, top: 62 });
    // Near the visible right edge: 1512+160 would clip at 1554 → flip left.
    expect(bubblePosition(1500, 50, BW, BH, v).left).toBe(1500 - BUBBLE_OFFSET - BW);
    // Near the visible left edge the lower-right placement already fits: no shove.
    expect(bubblePosition(1065, 50, BW, BH, v).left).toBe(1065 + BUBBLE_OFFSET);
  });

  it("degenerate guard: when neither side of the pointer fits, clamp to the window (covering the pointer is then unavoidable)", () => {
    const v = { left: 0, right: 200, bottom: CHART_H };
    const pos = bubblePosition(100, 100, 180, BH, v); // wider than either side of the pointer, still narrower than the window
    expect(pos.left).toBe(0); // flip target would be negative → clamped to the window's left edge
    expect(pos.left + 180).toBeLessThanOrEqual(v.right); // a bubble wider than the whole window would still clip on the right — unreachable at real card widths
  });
});
