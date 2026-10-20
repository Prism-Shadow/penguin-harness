/**
 * The basic charts' data and layout (charts/cartesian/cartesian-data.ts, plot-layout.ts): the
 * value axis, stacks, gaps, and where the labels fit.
 *
 * - Given readings, the value axis runs from zero to a round number just above the largest, in
 *   three to six round steps, wasting as little room as it can; a negative reading takes the axis
 *   below zero; a stack is scaled by its totals.
 * - Given a bound, it is kept exactly — unless a reading lies past it, which widens the axis
 *   rather than drawing a mark off the plot; a lower bound alone zooms in on the readings.
 * - Given an axis not read from zero, it fits round numbers around the readings alone, so 900 to
 *   1,000 fills the plot; a given bound still holds, and a single value keeps zero.
 * - Given no readings at all, the axis still has a span (no division by zero).
 * - Tick labels that would print the same text twice print it once, and the plot's left padding
 *   grows to fit the widest (never shrinking below the frame's own, never eating the plot).
 * - A null or a non-number breaks a series into runs; a stack counts it, and a negative, as
 *   nothing.
 * - A series paints in its own slot unless it names a paint.
 * - Category labels too long for their columns are shortened and thinned so none touch; the last
 *   one never runs past the plot's edge.
 * - The bare frame spreads its columns edge to edge (a lone point in the middle) and labels as
 *   many as fit, counting the values written over the points.
 */
import { describe, expect, it } from "vitest";
import {
  gapRuns,
  niceDomain,
  seriesPaint,
  stackLevels,
  tickLabels,
} from "../src/components/charts/cartesian/cartesian-data";
import {
  AXIS_FONT,
  bareColumns,
  categoryAxis,
  clipLabel,
  plotPadLeft,
  textWidth,
} from "../src/components/charts/cartesian/plot-layout";
import { PAD_L } from "../src/components/charts/chart-frame/chart-geom";

describe("the value axis", () => {
  it("runs from zero to a round number just above the readings, in three to six round steps", () => {
    expect(niceDomain([[3, 48, 17]])).toEqual({
      min: 0,
      max: 50,
      ticks: [0, 10, 20, 30, 40, 50],
    });
    // 0–500 in hundreds wastes less room than 0–600 in two hundreds.
    expect(niceDomain([[120, 402]]).ticks).toEqual([0, 100, 200, 300, 400, 500]);
    // A step of 250 fits 1,240 snugly; a count never steps by 2.5.
    expect(niceDomain([[1240]]).max).toBe(1250);
    expect(niceDomain([[7]]).ticks).toEqual([0, 2, 4, 6, 8]);
    expect(niceDomain([[0.4, 0.9]]).ticks).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
  });

  it("goes below zero for a negative reading, and scales a stack by its totals", () => {
    expect(niceDomain([[-12, 30]])).toEqual({
      min: -20,
      max: 30,
      ticks: [-20, -10, 0, 10, 20, 30],
    });
    expect(
      niceDomain(
        [
          [3, 1],
          [4, null],
        ],
        { stacked: true },
      ).max,
    ).toBe(8);
    expect(
      niceDomain([
        [3, 1],
        [4, null],
      ]).max,
    ).toBe(4);
  });

  it("keeps given bounds exactly, and a lower bound alone zooms in on the readings", () => {
    expect(niceDomain([[37]], { min: 0, max: 100 }).ticks).toEqual([0, 25, 50, 75, 100]);
    expect(niceDomain([[60, 88]], { min: 50 })).toEqual({
      min: 50,
      max: 90,
      ticks: [50, 60, 70, 80, 90],
    });
  });

  it("widens past a bound a reading exceeds rather than cutting the mark off", () => {
    const domain = niceDomain([[120]], { max: 100 });
    expect(domain.max).toBeGreaterThanOrEqual(120);
    expect(niceDomain([[20, 40]], { min: 30 }).min).toBeLessThanOrEqual(20);
  });

  it("fits an axis not read from zero around the readings alone, a given bound still holding", () => {
    expect(niceDomain([[912, 987]], { zero: false })).toEqual({
      min: 900,
      max: 1000,
      ticks: [900, 925, 950, 975, 1000],
    });
    expect(niceDomain([[-48, -12]], { zero: false })).toMatchObject({ min: -50, max: -10 });
    expect(niceDomain([[912, 987]], { zero: false, min: 0 }).min).toBe(0);
    expect(niceDomain([[912, 987]], { zero: false, max: 1200 }).max).toBe(1200);
    // A bar keeps zero; a lone value has no extent of its own and keeps it too.
    expect(niceDomain([[912, 987]]).min).toBe(0);
    expect(niceDomain([[950, 950]], { zero: false }).min).toBe(0);
  });

  it("still has a span with no readings at all", () => {
    expect(niceDomain([[null, null]])).toEqual({
      min: 0,
      max: 1,
      ticks: [0, 0.2, 0.4, 0.6, 0.8, 1],
    });
  });

  it("prints a repeated tick label once, and makes room for the widest", () => {
    const labels = tickLabels([0, 0.25, 0.5, 0.75, 1], (v) => String(Math.round(v)));
    expect(labels).toEqual(["0", "", "1", "", ""]);
    expect(plotPadLeft(["0", "40"])).toBe(PAD_L);
    const wide = plotPadLeft(["0", "12,500 KB/s"]);
    expect(wide).toBeGreaterThan(PAD_L);
    expect(wide).toBeGreaterThanOrEqual(textWidth("12,500 KB/s", AXIS_FONT));
    expect(plotPadLeft(["x".repeat(200)])).toBeLessThanOrEqual(120);
  });
});

describe("series", () => {
  it("break into runs at a null or a non-number", () => {
    expect(gapRuns([1, null, 2, 3, Number.NaN, 4])).toEqual([
      [{ index: 0, value: 1 }],
      [
        { index: 2, value: 2 },
        { index: 3, value: 3 },
      ],
      [{ index: 5, value: 4 }],
    ]);
    expect(gapRuns([null, null])).toEqual([]);
  });

  it("stack bottom to top, a null or a negative adding nothing", () => {
    expect(
      stackLevels([
        [1, null, -2],
        [2, 3, 4],
      ]),
    ).toEqual([
      [1, 0, 0],
      [3, 3, 4],
    ]);
  });

  it("paint in their own slot unless they name a paint", () => {
    expect(seriesPaint({ label: "a", values: [] }, 2)).toEqual({ series: 2 });
    expect(seriesPaint({ label: "a", values: [], paint: { ink: "text-accent" } }, 2)).toEqual({
      ink: "text-accent",
    });
  });
});

describe("labels", () => {
  it("measure a CJK character at a full em and a Latin one at a little over half", () => {
    expect(textWidth("周一", 10)).toBe(20);
    expect(textWidth("Mon", 10)).toBeLessThan(20);
  });

  it("shorten with an ellipsis to fit", () => {
    const clipped = clipLabel("Wednesday afternoon session", 60, AXIS_FONT);
    expect(clipped.endsWith("…")).toBe(true);
    expect(textWidth(clipped, AXIS_FONT)).toBeLessThanOrEqual(60);
    expect(clipLabel("Mon", 60, AXIS_FONT)).toBe("Mon");
  });

  it("thin out on narrow columns so no two touch, and the last stays inside the plot", () => {
    const dates = Array.from({ length: 30 }, (_, i) => `2026-10-${String(i + 1).padStart(2, "0")}`);
    const narrow = categoryAxis(dates, 20, 8);
    expect(narrow.shown.length).toBeLessThan(dates.length);
    const stride = narrow.shown[1]! - narrow.shown[0]!;
    expect(stride * 20).toBeGreaterThan(textWidth(dates[0]!, AXIS_FONT));
    const wide = categoryAxis(["Mon", "Tue", "Wed"], 120, 8);
    expect(wide.shown).toEqual([0, 1, 2]);
    expect(wide.text).toEqual(["Mon", "Tue", "Wed"]);
    // The last column is 60 px wide with 8 px past it: its label may take 76 px, not the 96 a
    // label elsewhere may.
    const long = categoryAxis(["a", "b", "a much longer final label"], 60, 8);
    expect(long.shown).toContain(2);
    expect(long.text[2]!.endsWith("…")).toBe(true);
    expect(textWidth(long.text[2]!, AXIS_FONT)).toBeLessThanOrEqual(2 * 8 + 60);
  });
});

describe("the bare frame", () => {
  it("spreads its columns edge to edge, a lone point in the middle", () => {
    const three = bareColumns(232, ["a", "b", "c"]);
    expect([three.x(0), three.x(1), three.x(2)]).toEqual([16, 116, 216]);
    expect(bareColumns(232, ["a"]).x(0)).toBe(116);
    expect(bareColumns(232, ["a"]).labelled).toEqual([0]);
  });

  it("labels as many columns as fit, counting the values over the points", () => {
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
    const roomy = bareColumns(24 * 60, hours);
    expect(roomy.labelled).toHaveLength(24);
    const packed = bareColumns(320, hours);
    expect(packed.labelled.length).toBeLessThan(24);
    expect(packed.labelled[0]).toBe(0);
    const tight = bareColumns(200, ["a", "b", "c", "d"], ["1,240,000 GB", "2", "3", "4"]);
    expect(tight.labelled.length).toBeLessThan(4);
  });
});
