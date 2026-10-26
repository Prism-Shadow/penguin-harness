/**
 * The scatter chart (src/components/charts/scatter-chart): points of each series on two value
 * axes.
 *
 * - Given points, each lands where its x and y fall on the axes: the lowest values at the plot's
 *   bottom-left corner, the largest at its top-right.
 * - Given readings far from zero, each axis fits round numbers around the data alone, so the
 *   points spread over the whole plot; a y bound the caller gives still holds.
 * - The ticks on both axes carry the caller's units; the y ticks have grid lines.
 * - Given many x ticks in little room, the x labels thin out so none touch; the last label keeps
 *   its room inside the canvas.
 * - Each series paints in its own slot, and a legend shows with more than one series.
 * - A point that is not a finite pair is left out rather than drawn at NaN.
 */
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { ScatterChart } from "../src/components/charts/scatter-chart/scatter-chart";
import type { ScatterChartProps } from "../src/components/charts/scatter-chart/scatter-chart";
import { numericPlot } from "../src/components/charts/scatter-chart/numeric-geom";
import { AXIS_FONT, textWidth } from "../src/components/charts/cartesian/plot-layout";
import { renderStatic } from "../src/testing";

const seconds = (v: number) => `${v} s`;
const ms = (v: number) => `${v} ms`;
const scatter = (props: Partial<ScatterChartProps> & Pick<ScatterChartProps, "series">) =>
  renderStatic(
    createElement(ScatterChart, {
      width: 300,
      fmtX: seconds,
      fmtY: ms,
      label: "Latency by duration",
      ...props,
    }),
  );

/** Each drawn point's centre and its 1-based series slot. */
function points(html: string) {
  return [
    ...html.matchAll(
      /<rect data-part="point" data-series="(\d+)" x="([-\d.e]+)" y="([-\d.e]+)" width="([-\d.e]+)"/g,
    ),
  ].map((m) => {
    const half = Number(m[4]) / 2;
    return { slot: Number(m[1]), x: Number(m[2]) + half, y: Number(m[3]) + half };
  });
}

describe("ScatterChart", () => {
  it("places the origin at the bottom-left corner and the largest values at the top-right", () => {
    const html = scatter({
      series: [
        {
          label: "api",
          points: [
            [0, 0],
            [10, 100],
          ],
        },
      ],
    });
    // The plot spans x 46–286 (left room for "100 ms", right room for half of "10 s") and y 10–178.
    const [origin, top] = points(html);
    expect(origin!.x).toBeCloseTo(46);
    expect(origin!.y).toBeCloseTo(178);
    expect(top!.x).toBeCloseTo(286);
    expect(top!.y).toBeCloseTo(10);
    expect(html).toContain('aria-label="Latency by duration"');
  });

  it("fits each axis around readings far from zero, a given y bound still holding", () => {
    const series = [
      {
        label: "api",
        points: [
          [212, 912],
          [236, 987],
        ] as [number, number][],
      },
    ];
    const plot = numericPlot({
      xs: [212, 236],
      ys: [912, 987],
      width: 300,
      height: 200,
      fmtX: seconds,
      fmtY: ms,
    });
    expect(plot.yTicks.map((tick) => tick.value)).toEqual([900, 925, 950, 975, 1000]);
    expect(plot.xTicks[0]?.value).toBe(210);
    // 912 ms sits low in the plot (y 10–178) and 987 ms high: the readings fill it.
    const [low, high] = points(scatter({ series }));
    expect(low!.y).toBeGreaterThan(150);
    expect(high!.y).toBeLessThan(40);
    expect(scatter({ series, min: 0 })).toContain(">0 ms<");
    expect(scatter({ series })).not.toContain(">0 ms<");
  });

  it("prints the caller's units on both axes, with grid lines at the y ticks", () => {
    const html = scatter({
      series: [
        {
          label: "api",
          points: [
            [0, 0],
            [10, 100],
          ],
        },
      ],
    });
    expect(html).toContain(">10 s<");
    expect(html).toContain(">100 ms<");
    expect(html.split('data-part="grid"').length - 1).toBe(5);
  });

  it("thins the x labels when they would touch, and keeps the last inside the canvas", () => {
    const plot = numericPlot({
      xs: [0, 1000],
      ys: [0, 1],
      width: 200,
      height: 200,
      fmtX: ms,
      fmtY: String,
    });
    expect(plot.xTicks.length).toBeLessThan(5);
    expect(plot.padR).toBeGreaterThanOrEqual(textWidth("1000 ms", AXIS_FONT) / 2);
  });

  it("paints each series in its own slot, with a legend for more than one", () => {
    const two = scatter({
      series: [
        { label: "api", points: [[1, 2]] },
        { label: "web", points: [[3, 4]] },
      ],
    });
    expect(points(two).map((p) => p.slot)).toEqual([1, 2]);
    expect(two).toMatch(/<ul[\s\S]*>api<[\s\S]*>web</);
    expect(scatter({ series: [{ label: "api", points: [[1, 2]] }] })).not.toContain("<ul");
  });

  it("leaves out a point that is not a finite pair", () => {
    const html = scatter({
      series: [
        {
          label: "api",
          points: [
            [1, 2],
            [Number.NaN, 3],
          ],
        },
      ],
    });
    expect(points(html)).toHaveLength(1);
    expect(html).not.toContain("NaN");
  });
});
