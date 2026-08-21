/**
 * Cost Center chart pure-function unit tests (chart-geom.ts): coordinate mapping, SVG path
 * assembly (straight and gap-split paths — every line on the page is straight segments,
 * nothing is smoothed), container-fitting bar width (charts never scroll), stacked-bar
 * segment geometry and per-segment hit bands, and hover-bubble placement (pointer lower-right, flipping at the edges; the cache hit rate
 * shown in the cacheRead bubble is lib/format's shared cacheHitRate, tested in
 * format.test.ts). Component interaction isn't covered here (vitest runs in a node
 * environment, no DOM).
 *
 * Canvas width is "measured container pixels" (1 canvas unit = 1 CSS pixel), so each case
 * passes an explicit width; 640 was the original fixed canvas width, and reusing it as the
 * sample width also proves the coordinate / path math is unchanged (zero regression for the
 * cost line chart).
 */
import { describe, expect, it } from "vitest";
import {
  makeGeom,
  makeRangeGeom,
  linePath,
  areaPath,
  lineSegments,
  segmentPath,
  sparseLabelIdx,
  autoLabelIdx,
  bubblePosition,
  fitBarWidth,
  barSegments,
  BAR_W,
  BUBBLE_OFFSET,
  CHART_H,
  MIN_HIT_H,
  PAD_L,
  PAD_R,
  PAD_R_AXIS,
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

  it("an explicit non-zero range maps its min to the baseline and max to the top", () => {
    const g = makeRangeGeom(2, 60, 100, 640);
    expect(g.min).toBe(60);
    expect(g.max).toBe(100);
    expect(g.y(60)).toBe(178);
    expect(g.y(100)).toBe(10);
    expect(g.y(80)).toBe(94);
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

describe("lineSegments / segmentPath (gap segmentation)", () => {
  it("no gaps: one segment with everything (consecutive indexes)", () => {
    expect(lineSegments([60, 75.25, 85.5])).toEqual([
      [
        { index: 0, value: 60 },
        { index: 1, value: 75.25 },
        { index: 2, value: 85.5 },
      ],
    ]);
  });

  it("a middle gap breaks into two segments (a lone point still forms a segment: point drawn, no line)", () => {
    expect(lineSegments([0.12, null, 0.2])).toEqual([
      [{ index: 0, value: 0.12 }],
      [{ index: 2, value: 0.2 }],
    ]);
    expect(lineSegments([null, 1, 2, null, 3])).toEqual([
      [
        { index: 1, value: 1 },
        { index: 2, value: 2 },
      ],
      [{ index: 4, value: 3 }],
    ]);
  });

  it("all missing / empty list: no segments", () => {
    expect(lineSegments([null, null])).toEqual([]);
    expect(lineSegments([])).toEqual([]);
  });

  it("a segment strokes only its own indexes, so nothing bridges the hole between two segments", () => {
    const g = makeRangeGeom(3, 0, 100, 640);
    /** Path coordinates are rounded to 2 decimals (see chart-geom's rnd). */
    const at = (i: number, v: number) => `${Math.round(g.x(i) * 100) / 100},${g.y(v)}`;
    const [first, second] = lineSegments([100, null, 0]);
    expect(segmentPath(g, first!)).toBe(`M${at(0, 100)}`);
    expect(segmentPath(g, second!)).toBe(`M${at(2, 0)}`);
    expect(segmentPath(g, [])).toBe("");
    // A two-point run is one straight stroke between exactly those two indexes.
    expect(segmentPath(g, lineSegments([100, 0, null])[0]!)).toBe(`M${at(0, 100)} L${at(1, 0)}`);
  });
});

describe("fitBarWidth", () => {
  it("60% of the cell, capped at BAR_W: wide cells keep the 25px ceiling, narrow ones shrink with the cell", () => {
    expect(fitBarWidth(100)).toBe(BAR_W);
    expect(fitBarWidth(50)).toBe(BAR_W);
    expect(fitBarWidth(41)).toBe(24);
    expect(fitBarWidth(20)).toBe(12);
  });

  it("floors at 1px hairlines instead of overlapping: a bar never exceeds a >=1.7px cell", () => {
    expect(fitBarWidth(3)).toBe(1);
    expect(fitBarWidth(1.8)).toBe(1);
    expect(fitBarWidth(0)).toBe(1);
  });

  it("bars centered in their cells never touch: gap = step - barW >= 40% of the cell", () => {
    for (const step of [2, 5, 10, 25, 50, 133]) {
      expect(step - fitBarWidth(step)).toBeGreaterThanOrEqual(step * 0.4 - 1);
    }
  });
});

describe("padR (right-axis room)", () => {
  it("defaults to PAD_R; PAD_R_AXIS widens the right padding and shrinks the inner width", () => {
    expect(makeGeom(2, 100, 640).padR).toBe(PAD_R);
    const g = makeGeom(2, 100, 640, PAD_R_AXIS);
    expect(g.padR).toBe(PAD_R_AXIS);
    expect(g.innerW).toBe(640 - PAD_L - PAD_R_AXIS);
  });

  it("geoms sharing n / w / padR share x() exactly — an overlay on its own y scale stays aligned with the marks under it", () => {
    const bars = makeGeom(5, 12345, 640, PAD_R_AXIS);
    const rate = makeRangeGeom(5, 0, 100, 640, PAD_R_AXIS);
    for (let i = 0; i < 5; i++) expect(rate.x(i)).toBe(bars.x(i));
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

describe("sparseLabelIdx", () => {
  it("sparse first/middle/last labeling", () => {
    expect(sparseLabelIdx(0)).toEqual([]);
    expect(sparseLabelIdx(1)).toEqual([0]);
    expect(sparseLabelIdx(2)).toEqual([0, 1]);
    expect(sparseLabelIdx(5)).toEqual([0, 2, 4]);
    expect(sparseLabelIdx(30)).toEqual([0, 14, 29]);
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
