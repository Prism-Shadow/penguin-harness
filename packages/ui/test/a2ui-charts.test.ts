/**
 * The A2UI chart block and the system-resource board (src/components/content/a2ui), each drawn
 * from the JSON a model writes, through the grammar, by the basic charts.
 *
 * Static markup only. A static render never measures the surface, so every plot here draws at
 * its fallback width: that is the promise that a chart is never blank before layout.
 *
 * - Given a chart of each kind, the block draws that kind's chart on a `chart` surface, the
 *   picture named by the data in words: the kind, the title, the counts, each series' range.
 * - Given a gauge, the block is one tile: the same meter, figure ink and tone a one-item metrics
 *   block draws for the same reading.
 * - Given stacked horizontal bars, each category is one row on one scale, its series end to end
 *   from zero, its total after it, its parts read out in words, the series named in a legend.
 * - Given grouped horizontal bars of several series, each reading is a row, the category named
 *   on its first row and the series said to a screen reader; a series with no reading in a
 *   category draws no row there.
 * - Given the reader's language is Chinese, the summary is worded and punctuated in Chinese.
 * - Given a resource board, each reading is a tile in board order, toned by the fixed marks
 *   (not by anything the model sets); each disk is a row with its used of total, its bar toned
 *   the same way; the network is a line chart of the received and the sent rate in their unit,
 *   with no category axis (the readings carry no times) and a caption counting its readings.
 * - Given a board with only disks, it draws no tiles and no network chart.
 */
import { createElement } from "react";
import type { ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { A2uiBlock } from "../src/components/content/a2ui/a2ui-block";
import { DEFAULT_UI_STRINGS, UiStringsProvider } from "../src/strings";
import type { UiStrings } from "../src/strings";
import { renderStatic } from "../src/testing";

/** A block as a reply carries it: the JSON source, parsed by the grammar, drawn by its renderer. */
const draw = (spec: object, strings?: UiStrings) => {
  const element: ReactElement = createElement(A2uiBlock, { source: JSON.stringify(spec) });
  return renderStatic(
    strings === undefined
      ? element
      : createElement(UiStringsProvider, { strings, children: element }),
  );
};

/** How many times `needle` occurs in `html`. */
const count = (html: string, needle: string) => html.split(needle).length - 1;

/** The accessible names of the images in `html`, in order. */
const imageNames = (html: string) =>
  [...html.matchAll(/role="img"[^>]*?aria-label="([^"]*)"/g)].map((m) => m[1]);

/** Each horizontal bar's place along its track, in percent, in row order. */
const barPlaces = (html: string) =>
  [...html.matchAll(/data-part="bar"[^>]*style="left:([\d.]+)%;width:([\d.]+)%/g)].map((m) => ({
    left: Number(m[1]),
    width: Number(m[2]),
  }));

/** The class of each big figure, in order. */
const figureClasses = (html: string) =>
  [...html.matchAll(/data-figure="true" class="([^"]*)"/g)].map((m) => m[1]);

/** The first meter's opening tag. */
const meter = (html: string) => html.match(/<[a-z]+ [^>]*role="meter"[^>]*>/)?.[0];

const LATENCY = {
  type: "chart",
  kind: "bar",
  title: "Latency",
  categories: ["Mon", "Tue", "Wed"],
  series: [
    { label: "p50", values: [12, 30, 18] },
    { label: "p95", values: [40, 90, 55] },
  ],
  yUnit: "ms",
};

describe("ChartBlock", () => {
  it("draws grouped bars, a bar per category and series in its slot, named by the data", () => {
    const html = draw(LATENCY);
    expect(html).toContain('data-widget="chart"');
    expect(html).not.toContain('data-a2ui="invalid"');
    expect(imageNames(html)).toContain(
      "Bar chart: Latency. 3 categories, 2 series: p50 12–30 ms, p95 40–90 ms.",
    );
    expect(count(html, 'data-part="bar" data-series="1"')).toBe(3);
    expect(count(html, 'data-part="bar" data-series="2"')).toBe(3);
    // The value axis prints its unit; the legend names both series.
    expect(html).toMatch(/>\d+ ms</);
    expect(html).toContain(">p95<");
  });

  it.each([
    [
      "a line with a gap",
      {
        type: "chart",
        kind: "line",
        categories: ["1", "2", "3", "4", "5"],
        series: [{ label: "Load", values: [1, 2, null, 3, 4] }],
      },
      "Line chart. 5 categories, 1 series: Load 1–4.",
      'data-chart="line"',
    ],
    [
      "a stacked area",
      {
        type: "chart",
        kind: "area",
        stacked: true,
        categories: ["Q1", "Q2"],
        series: [
          { label: "Web", values: [3, 4] },
          { label: "App", values: [1, 2] },
        ],
        yUnit: "k",
      },
      "Area chart. 2 categories, 2 series: Web 3–4 k, App 1–2 k.",
      'data-part="area"',
    ],
    [
      "a donut",
      {
        type: "chart",
        kind: "pie",
        title: "Storage",
        donut: true,
        categories: ["Code", "Docs", "Assets"],
        series: [{ label: "GB", values: [50, 30, 20] }],
        yUnit: "GB",
      },
      "Pie chart: Storage. 3 categories: Code 50%, Docs 30%, Assets 20%.",
      ">Assets<",
    ],
    [
      "a scatter",
      {
        type: "chart",
        kind: "scatter",
        series: [
          {
            label: "small",
            points: [
              [1, 10],
              [3, 30],
            ],
          },
          {
            label: "large",
            points: [
              [10, 50],
              [30, 90],
            ],
          },
        ],
        xUnit: "KB",
        yUnit: "ms",
        min: 0,
        max: 120,
      },
      "Scatter plot. 2 series: small (x 1–3 KB, y 10–30 ms), large (x 10–30 KB, y 50–90 ms).",
      // The y axis runs to the model's bound, past the data's own round number.
      ">120 ms<",
    ],
    [
      "a histogram",
      {
        type: "chart",
        kind: "histogram",
        title: "Latency",
        edges: [0, 10, 20, 30],
        series: [{ label: "requests", values: [2, 12, 5] }],
        xUnit: "ms",
      },
      "Histogram: Latency. 3 categories: 0–30 ms, requests 2–12.",
      ">0–10 ms<",
    ],
  ])("draws %s on the chart surface, named by the data", (_, spec, name, mark) => {
    const html = draw(spec);
    expect(html).toContain('data-widget="chart"');
    expect(html).not.toContain('data-a2ui="invalid"');
    expect(imageNames(html)).toContain(name);
    expect(html).toContain(mark);
  });

  it("draws a plot at a width before its surface is measured", () => {
    expect(draw(LATENCY)).toMatch(/<svg[^>]*width="320"/);
  });

  it("draws a gauge as the one tile a one-item metrics block draws for the reading", () => {
    const item = { label: "Disk", value: 480, max: 512, unit: "GB", warn: 400, danger: 470 };
    const gauge = draw({ type: "chart", kind: "gauge", item });
    const metrics = draw({ type: "metrics", items: [item] });
    expect(gauge).toContain('data-widget="chart"');
    expect(count(gauge, "data-tile")).toBe(1);
    expect(meter(gauge)).toBeDefined();
    expect(meter(gauge)).toBe(meter(metrics));
    expect(figureClasses(gauge)).toEqual(figureClasses(metrics));
    expect(figureClasses(gauge)[0]).toContain("text-tone-danger-fg");
  });

  it("stacks each category's series end to end in one row, its total after it", () => {
    const stacked = draw({
      type: "chart",
      kind: "bar",
      horizontal: true,
      stacked: true,
      categories: ["eu", "us"],
      series: [
        { label: "read", values: [20, 30] },
        { label: "write", values: [20, 10] },
      ],
      yUnit: "GB",
    });
    const [euRead, euWrite, usRead, usWrite] = barPlaces(stacked);
    expect(euRead?.left).toBe(0);
    expect(euWrite?.left).toBe(euRead?.width);
    expect(usWrite?.left).toBe(usRead?.width);
    expect(euWrite?.width).toBeCloseTo(50);
    expect(usWrite?.width).toBeCloseTo(25);
    // One row per category, its total printed and its parts said; the legend names the series.
    expect(count(stacked, ">eu<")).toBe(1);
    expect(stacked).toContain('<span class="sr-only"> · read 20 GB · write 20 GB</span>');
    expect(count(stacked, ">40 GB<")).toBe(2);
    expect(count(stacked, "data-hit")).toBe(4);
    expect(stacked).toMatch(/>read<[\s\S]*>write</);
  });

  it("lays grouped horizontal bars out as a row per reading, none for a missing one", () => {
    const html = draw({
      type: "chart",
      kind: "bar",
      horizontal: true,
      categories: ["eu", "us"],
      series: [
        { label: "read", values: [20, null] },
        { label: "write", values: [20, 10] },
      ],
    });
    const places = barPlaces(html);
    expect(places).toHaveLength(3);
    for (const place of places) expect(place.left).toBe(0);
    expect(count(html, ">eu<")).toBe(1);
    expect(html).toMatch(/class="sr-only">write</);
    expect(html).toMatch(/data-series="2"[^>]*left:0%;width:50%/);
    expect(html).not.toContain("data-hit");
  });

  it("words the summary in the reader's language", () => {
    const zh: UiStrings = {
      ...DEFAULT_UI_STRINGS,
      a2ui: {
        ...DEFAULT_UI_STRINGS.a2ui,
        lang: "zh",
        chartKind: { ...DEFAULT_UI_STRINGS.a2ui.chartKind, bar: "柱状图" },
        categories: (n) => `${n} 个类别`,
        seriesCount: (n) => `${n} 个系列`,
      },
    };
    expect(imageNames(draw(LATENCY, zh))).toContain(
      "柱状图：Latency。3 个类别，2 个系列：p50 12–30 ms，p95 40–90 ms。",
    );
  });
});

describe("ResourcesBlock", () => {
  const BOARD = {
    type: "resources",
    host: "build-01",
    cpu: { percent: 97, cores: 8, history: [40, 60, 97] },
    memory: { used: 13.9, total: 16 },
    swap: { used: 0.1, total: 2 },
    disks: [
      { path: "/", used: 100, total: 500 },
      { path: "/data", used: 480, total: 500 },
    ],
    network: { unit: "KB/s", rx: [120, 98, 140], tx: [40, 35, 50] },
    load: { one: 1.2, cores: 4 },
    uptimeSec: 1_071_360,
    asOf: "2026-10-19T14:05:00+08:00",
  };

  it("draws a tile per reading in board order, each toned by the fixed marks", () => {
    const html = draw(BOARD);
    expect(html).toContain('data-widget="resources"');
    expect(html).toContain('aria-label="build-01"');
    const labels = [...html.matchAll(/data-tile="true"[^>]*><span[^>]*>([^<]*)</g)].map(
      (m) => m[1],
    );
    expect(labels).toEqual(["CPU", "Memory", "Swap", "Load", "Uptime"]);
    const [cpu, memory, swap, load] = figureClasses(html);
    expect(cpu).toContain("text-tone-danger-fg");
    expect(memory).toContain("text-tone-attention-fg");
    expect(swap).not.toMatch(/text-tone-/);
    expect(load).not.toMatch(/text-tone-/);
    expect(html).toContain("8 cores");
  });

  it("draws each disk as a row with its used of total, its bar toned by the disk marks", () => {
    const html = draw(BOARD);
    expect(html).toContain('aria-label="Disks"');
    expect(html).toContain("100 / 500 GB");
    expect(html).toMatch(/text-tone-danger-fg">480 \/ 500 GB</);
    const [root, data] = barPlaces(html);
    expect(root?.width).toBeCloseTo(20);
    expect(data?.width).toBeCloseTo(96);
    expect(html).toContain("bg-tone-danger-emphasis");
  });

  it("draws the network as a line chart of the received and the sent rate", () => {
    const html = draw(BOARD);
    expect(imageNames(html)).toContain(
      "Line chart: Network. 3 categories, 2 series: Received 98–140 KB/s, Sent 35–50 KB/s.",
    );
    expect(html).toMatch(/data-part="series" data-series="1"/);
    expect(html).toMatch(/data-part="series" data-series="2"/);
    expect(html).toContain(">Received<");
    expect(html).toContain(">Sent<");
    // No times, so no category axis: the caption says how many readings the lines span.
    expect(html).toMatch(/data-caption="x"[^>]*>Last 3 readings</);
  });

  it("draws no tiles and no network chart for a board of disks alone", () => {
    const html = draw({
      type: "resources",
      disks: [{ path: "C:", used: 1, total: 2, unit: "TB" }],
    });
    expect(html).toContain('data-widget="resources"');
    expect(html).toContain('aria-label="System resources"');
    expect(html).toContain("1 / 2 TB");
    expect(html).not.toContain("data-tile");
    expect(html).not.toContain('data-chart="line"');
  });
});
