/**
 * The basic cartesian charts (src/components/charts/cartesian): what each draws from its data, in
 * the default theme (the record the server snapshot of useChartStyle hands out).
 *
 * - Given grouped series, a bar chart draws one bar per category per series, each in its series'
 *   slot, a column's bars next to each other, and none for a missing reading.
 * - Given stacked series, each column's bars sit on one another and the stack tops out at the
 *   column's total.
 * - Given flush bars (a histogram), each bin fills its column less a one-pixel seam.
 * - Given a negative value, its bar hangs from zero.
 * - Given axis names, they print around the plot, and the tick labels carry the caller's unit.
 * - A legend shows only with more than one series, unless asked for.
 * - The hover bubble names the category and lists every series, a missing reading as a dash; a
 *   category with no name is left out of it.
 * - Given a null, a line breaks into two; a reading with no neighbour is a lone dot.
 * - Given a stacked area, each band fills down to the band under it, not to the axis.
 * - Given draw-in, the lines (and only the lines) sit in the group the draw-in animates.
 * - In the bare frame there is no grid or value axis; a flat run draws level through the middle,
 *   with its values over the points and its categories under them.
 * - Given categories with no names (readings with no times), the plot prints no category axis and
 *   reaches down into the band its labels would have taken.
 * - A horizontal bar chart places each row's range (or value from the start) on the one shared
 *   scale, clamped to the track, in the row's tone when it has one; the bars are hidden from
 *   assistive technology and the list is named.
 * - Given a stack row, its series sit end to end in one row from zero, each segment in its series'
 *   slot and each a target for the pointer; a missing or zero reading takes no room; the parts are
 *   read out in words after the row's label, and a legend names the series.
 * - Given a one-bar row that names its series, the bar takes that series' colour.
 * - A segment's bubble names the row, then the segment's series beside its swatch, with its value.
 * - A chart given no width yet draws nothing broken.
 */
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { BarChart } from "../src/components/charts/cartesian/bar-chart";
import type { BarChartProps } from "../src/components/charts/cartesian/bar-chart";
import { HBarChart } from "../src/components/charts/cartesian/hbar-chart";
import { LineChart } from "../src/components/charts/cartesian/line-chart";
import type { LineChartProps } from "../src/components/charts/cartesian/line-chart";
import { SegmentBubble, SeriesBubble } from "../src/components/charts/cartesian/series-readout";
import { DEFAULT_CHART_STYLE } from "../src/components/charts/chart-style";
import { renderStatic } from "../src/testing";

const ms = (v: number) => `${v} ms`;
const gb = (v: number) => `${v} GB`;

const bars = (props: Partial<BarChartProps> & Pick<BarChartProps, "categories" | "series">) =>
  renderStatic(createElement(BarChart, { width: 400, fmtValue: ms, label: "Latency", ...props }));

const lines = (props: Partial<LineChartProps> & Pick<LineChartProps, "categories" | "series">) =>
  renderStatic(createElement(LineChart, { width: 400, fmtValue: ms, label: "Latency", ...props }));

/** Every bar rect in the markup: its box and its 1-based series slot. */
function barRects(html: string) {
  return [
    ...html.matchAll(
      /<rect x="([-\d.e]+)" y="([-\d.e]+)" width="([-\d.e]+)" height="([-\d.e]+)" data-part="bar" data-series="(\d+)"/g,
    ),
  ].map((m) => ({
    x: Number(m[1]),
    y: Number(m[2]),
    width: Number(m[3]),
    height: Number(m[4]),
    slot: Number(m[5]),
  }));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("BarChart", () => {
  it("draws a bar per category per series in the series' slot, and none for a missing reading", () => {
    const html = bars({
      categories: ["Mon", "Tue", "Wed"],
      series: [
        { label: "p50", values: [10, 20, 30] },
        { label: "p95", values: [5, null, 15] },
      ],
    });
    const rects = barRects(html);
    expect(rects.filter((r) => r.slot === 1)).toHaveLength(3);
    expect(rects.filter((r) => r.slot === 2)).toHaveLength(2);
    expect(html).toContain(`color:${DEFAULT_CHART_STYLE.series[0]}`);
    expect(html).toContain(`color:${DEFAULT_CHART_STYLE.series[1]}`);
    // Side by side: a column's two bars stand next to each other, a hairline apart.
    const [mon50, mon95] = rects;
    expect(mon95!.x - (mon50!.x + mon50!.width)).toBeCloseTo(2);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Latency"');
  });

  it("stacks a column's series, the stack topping out at the column's total", () => {
    const html = bars({
      categories: ["Q1"],
      series: [
        { label: "a", values: [3] },
        { label: "b", values: [4] },
      ],
      stacked: true,
      width: 300,
    });
    // The axis runs 0–8 over 168 px from y=10: 7 sits at y=31, 3 at y=115, 0 at y=178.
    const [bottom, top] = barRects(html);
    expect(bottom).toMatchObject({ y: 115, height: 63, slot: 1 });
    expect(top).toMatchObject({ y: 31, height: 84, slot: 2 });
  });

  it("fills each column with a flush bin, less a one-pixel seam", () => {
    const html = bars({
      categories: ["0–50", "50–100", "100–150", "150–200"],
      series: [{ label: "Requests", values: [2, 5, 3, 1] }],
      flush: true,
    });
    const rects = barRects(html);
    expect(rects).toHaveLength(4);
    // 346 px of plot over four columns: 86.5 px each.
    for (const r of rects) expect(r.width).toBeCloseTo(85.5);
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i]!.x - (rects[i - 1]!.x + rects[i - 1]!.width)).toBeCloseTo(1);
    }
  });

  it("hangs a negative value's bar from zero", () => {
    const html = bars({
      categories: ["a", "b"],
      series: [{ label: "Change", values: [-5, 10] }],
      width: 300,
    });
    // The axis runs −5 to 10: zero sits at y=122, −5 at the foot (178), 10 at the top (10).
    const [negative, positive] = barRects(html);
    expect(negative!.y).toBeCloseTo(122);
    expect(negative!.height).toBeCloseTo(56);
    expect(positive!.y).toBeCloseTo(10);
    expect(positive!.height).toBeCloseTo(112);
  });

  it("prints the axis names around the plot, and the caller's unit on the ticks", () => {
    const named = bars({
      categories: ["Mon", "Tue"],
      series: [{ label: "p50", values: [10, 30] }],
      captions: { x: "Day", y: "Latency" },
    });
    expect(named).toMatch(/data-caption="y"[^>]*>Latency</);
    expect(named).toMatch(/data-caption="x"[^>]*>Day</);
    expect(named).toContain(">0 ms<");
    expect(named).toContain(">30 ms<");
    const bare = bars({ categories: ["Mon"], series: [{ label: "p50", values: [10] }] });
    expect(bare).not.toContain("data-caption");
  });

  it("shows a legend only with more than one series, unless asked for", () => {
    const one = { categories: ["Mon"], series: [{ label: "p50", values: [10] }] };
    expect(bars(one)).not.toContain("<ul");
    expect(bars({ ...one, legend: true })).toMatch(/<ul[\s\S]*>p50</);
    const two = bars({
      categories: ["Mon"],
      series: [
        { label: "p50", values: [10] },
        { label: "p95", values: [20] },
      ],
    });
    expect(two).toMatch(/<ul[\s\S]*>p50<[\s\S]*>p95</);
  });

  it("draws nothing broken before its width is known", () => {
    const html = bars({
      categories: ["Mon", "Tue"],
      series: [{ label: "p50", values: [10, 30] }],
      width: 0,
    });
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});

describe("the hover bubble", () => {
  it("names the category and lists every series, a missing reading as a dash", () => {
    const html = renderStatic(
      createElement(SeriesBubble, {
        title: "Tuesday",
        series: [
          { label: "api", values: [10, null] },
          { label: "web", values: [5, 6] },
        ],
        index: 1,
        mark: "line",
        fmtValue: ms,
      }),
    );
    expect(count(html, "<p")).toBe(3);
    expect(html).toMatch(/>Tuesday<[\s\S]*>api<[\s\S]*>—<[\s\S]*>web<[\s\S]*>6 ms</);
    expect(html).toContain(`background-color:${DEFAULT_CHART_STYLE.series[0]}`);
    expect(html).toContain(`background-color:${DEFAULT_CHART_STYLE.series[1]}`);
  });

  it("leaves out a category with no name", () => {
    const html = renderStatic(
      createElement(SeriesBubble, {
        title: "",
        series: [{ label: "Received", values: [120] }],
        index: 0,
        mark: "line",
        fmtValue: ms,
      }),
    );
    expect(count(html, "<p")).toBe(1);
    expect(html).toMatch(/>Received<[\s\S]*>120 ms</);
  });

  it("over a segment, names the row, then the segment's series and its value", () => {
    const html = renderStatic(
      createElement(SegmentBubble, {
        title: "eu-west",
        series: "Write",
        paint: { series: 1 },
        value: "120 GB",
      }),
    );
    expect(html).toMatch(/>eu-west<[\s\S]*>Write<[\s\S]*>120 GB</);
    expect(html).toContain(`background-color:${DEFAULT_CHART_STYLE.series[1]}`);
    expect(html).toContain('aria-hidden="true"');
  });
});

describe("LineChart", () => {
  it("breaks a line at a missing reading, and dots a reading with no neighbour", () => {
    const broken = lines({
      categories: ["a", "b", "c", "d", "e"],
      series: [{ label: "api", values: [1, 2, null, 4, 5] }],
    });
    expect(count(broken, 'data-part="series"')).toBe(2);
    expect(count(broken, 'data-part="point"')).toBe(4);
    const lone = lines({
      categories: ["a", "b", "c", "d"],
      series: [{ label: "api", values: [1, null, 3, null] }],
    });
    expect(lone).not.toContain('data-part="series"');
    expect(count(lone, 'data-part="point"')).toBe(2);
  });

  it("fills each band of a stacked area down to the band under it", () => {
    const html = lines({
      categories: ["a", "b"],
      series: [
        { label: "postgres", values: [1, 1] },
        { label: "node", values: [2, 2] },
      ],
      area: true,
      stacked: true,
      width: 300,
    });
    // The axis runs 0–3: the first layer's top (1) is y=122, the stack's (3) y=10, zero y=178.
    const areas = [...html.matchAll(/<path data-part="area"[^>]* d="([^"]+)"/g)].map((m) => m[1]);
    expect(areas).toEqual([
      "M107.5,122 L230.5,122 L230.5,178 L107.5,178 Z",
      "M107.5,10 L230.5,10 L230.5,122 L107.5,122 Z",
    ]);
  });

  it("puts the lines, and only the lines, in the draw-in group when asked", () => {
    const series = [{ label: "api", values: [1, 2, 3] }];
    const drawn = lines({ categories: ["a", "b", "c"], series, area: true, drawIn: true });
    expect(drawn).toMatch(/<g data-anim="draw"><path data-part="series"[^>]*><\/path><\/g>/);
    const still = lines({ categories: ["a", "b", "c"], series });
    expect(still).not.toContain("data-anim");
  });

  it("draws a bare frame with no grid: a flat run level through the middle, values over it", () => {
    const html = lines({
      categories: ["09:00", "10:00", "11:00"],
      series: [{ label: "Temperature", values: [5, 5, 5], paint: { ink: "text-accent" } }],
      frame: "bare",
      pointLabels: true,
      width: 232,
      fmtValue: (v: number) => `${v}°`,
    });
    expect(html).not.toContain('data-part="grid"');
    expect(html).toContain('height="88"');
    // Labels take the top 24 px and the hours the bottom 28: the plot is y 24–60, its middle 42.
    expect(html).toContain('d="M16,42 L116,42 L216,42"');
    expect(count(html, 'data-part="label"')).toBe(3);
    expect(html).toMatch(/data-part="axis"[^>]*>09:00</);
    expect(html).toContain("text-accent");
  });
});

describe("a plot whose categories have no names", () => {
  it("prints no category axis, and reaches down into the band its labels would take", () => {
    /** The y of the lowest grid line. */
    const floor = (html: string) =>
      Math.max(
        ...[...html.matchAll(/data-part="grid"[^>]* y1="([\d.]+)"/g)].map((m) => Number(m[1])),
      );
    const series = [{ label: "Received", values: [120, 98, 140] }];
    const unnamed = lines({ categories: ["", "", ""], series, height: 120 });
    const named = lines({ categories: ["1", "2", "3"], series, height: 120 });
    // 120 px tall: the labelled plot stops 22 px above the foot for its labels, the other 6 px.
    expect(floor(named)).toBe(98);
    expect(floor(unnamed)).toBe(114);
    expect(named).toMatch(/text-anchor="middle"[^>]*>1</);
    expect(unnamed).not.toMatch(/text-anchor="middle"/);
  });
});

describe("HBarChart", () => {
  it("places each row's range on the one shared scale", () => {
    const html = renderStatic(
      createElement(HBarChart, {
        rows: [
          { label: "Mon", from: 10, to: 20, value: "10° / 20°" },
          { label: "Tue", from: 15, to: 25, value: "15° / 25°" },
        ],
        min: 10,
        max: 30,
        label: "Next days",
      }),
    );
    expect(html).toContain("left:0%;width:50%");
    expect(html).toContain("left:25%;width:50%");
    expect(html).toContain('aria-label="Next days"');
    expect(count(html, 'aria-hidden="true"')).toBe(2);
    expect(html).toMatch(/>Tue<[\s\S]*>15° \/ 25°</);
  });

  it("draws a value from the scale's start in the row's tone, clamped to the track", () => {
    const html = renderStatic(
      createElement(HBarChart, {
        rows: [
          { label: "/data", to: 86, tone: "attention" },
          { label: "/scratch", to: 140 },
        ],
        max: 100,
        label: "Disks",
      }),
    );
    expect(html).toContain("left:0%;width:86%");
    expect(html).toContain("bg-tone-attention-emphasis");
    expect(html).toContain("left:0%;width:100%");
    expect(html).toContain(`background-color:${DEFAULT_CHART_STYLE.series[0]}`);
  });

  it("stacks a row's series end to end from zero, each segment a target in its series' slot", () => {
    const html = renderStatic(
      createElement(HBarChart, {
        rows: [
          { label: "eu-west", stack: [420, 120], value: "540 GB" },
          { label: "ap-south", stack: [null, 60], value: "60 GB" },
          { label: "us-east", stack: [0, 250], value: "250 GB" },
        ],
        max: 1000,
        series: [{ label: "Read" }, { label: "Write" }],
        fmtValue: gb,
        label: "Traffic by region",
      }),
    );
    expect(html).toContain("left:0%;width:42%");
    expect(html).toContain("left:42%;width:12%");
    // A missing or zero reading takes no room: the next series starts from zero.
    expect(html).toContain("left:0%;width:6%");
    expect(html).toContain("left:0%;width:25%");
    expect(count(html, 'data-part="bar"')).toBe(4);
    expect(count(html, "data-hit")).toBe(4);
    expect(html).toMatch(/data-part="bar" data-series="1"[^>]*left:0%;width:42%/);
    expect(html).toMatch(/data-part="bar" data-series="2"[^>]*left:42%;width:12%/);
    // One row per region, its parts read out after its label and its total printed after the bar.
    expect(count(html, "<li")).toBe(3 + 2);
    expect(html).toMatch(/>eu-west<span class="sr-only"> · Read 420 GB · Write 120 GB</);
    expect(html).toContain('<span class="sr-only"> · Write 60 GB</span>');
    expect(html).toContain('<span class="sr-only"> · Read 0 GB · Write 250 GB</span>');
    expect(html).toMatch(/>540 GB</);
    expect(html).toMatch(/<ul[^>]*>[\s\S]*<\/ul><ul[\s\S]*>Read<[\s\S]*>Write</);
  });

  it("paints a one-bar row that names its series in that series' colour", () => {
    const html = renderStatic(
      createElement(HBarChart, {
        rows: [
          { label: "eu-west", to: 420, series: 0 },
          { label: "", to: 120, series: 1 },
        ],
        max: 1000,
        series: [{ label: "Read" }, { label: "Write" }],
        label: "Traffic by region",
      }),
    );
    expect(html).toMatch(/data-series="2"[^>]*left:0%;width:12%/);
    expect(html).toContain(`background-color:${DEFAULT_CHART_STYLE.series[1]}`);
    expect(html).not.toContain("data-hit");
  });
});
