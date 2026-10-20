/**
 * The chart primitives (src/components/charts/marks): what each draws in the default theme — the
 * record the server snapshot of useChartStyle hands out — the chart inks they spell as tokens,
 * and two guards on who draws what: the package's own charts draw every mark through the
 * primitives, and the A2UI blocks composed of charts draw through the basic charts, never a
 * picture of their own — so a composite and the chart it shows are one thing, called, not copied.
 *
 * The same guard over the Web App's charts is its `chart-marks.test.ts`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import {
  ChartArc,
  ChartArea,
  ChartAxis,
  ChartBar,
  ChartCursor,
  ChartGrid,
  ChartLabel,
  ChartLine,
  ChartPoint,
  ChartSwatch,
  barPath,
} from "../src/components/charts/marks/marks";
import { TimelineBar, timelineRadius } from "../src/components/charts/marks/timeline-bar";
import { DEFAULT_CHART_STYLE } from "../src/components/charts/chart-style";
import { renderStatic } from "../src/testing";
import { SRC_DIR } from "./helpers/paths";

// Each primitive has its own props; the helper only renders one, so it takes any component.
const render = (type: (props: any) => ReactElement | null, props: object) =>
  renderStatic(createElement(type, props));

describe("the chart primitives, in the default theme", () => {
  it("draw a bar at the theme's share of its band, square, unoutlined, in its slot's colour", () => {
    const html = render(ChartBar, { cx: 50, band: 20, y: 10, height: 30, paint: { series: 1 } });
    expect(html).toContain("<rect");
    expect(html).toContain('width="12"');
    expect(html).toContain('x="44"');
    expect(html).toContain('data-part="bar"');
    expect(html).toContain('data-series="2"');
    expect(html).toContain(`color:${DEFAULT_CHART_STYLE.series[1]}`);
    expect(html).not.toContain("stroke");
    expect(html).not.toContain("fill-opacity");
  });

  it("round a bar's top corners only when a theme gives a radius, clamped to the bar", () => {
    expect(barPath(0, 0, 10, 20, 0)).toBeNull();
    expect(barPath(0, 0, 10, 20, 3)).toBe("M0,20 V3 A3,3 0 0 1 3,0 H7 A3,3 0 0 1 10,3 V20 Z");
    expect(barPath(0, 0, 4, 20, 9)).toContain("A2,2");
  });

  it("draw a flush bar across its whole band less a one-pixel seam, square-cornered", () => {
    const html = render(ChartBar, {
      cx: 50,
      band: 20,
      y: 10,
      height: 30,
      paint: { series: 0 },
      flush: true,
    });
    expect(html).toContain("<rect");
    expect(html).toContain('width="19"');
    expect(html).toContain('x="40.5"');
  });

  it("draw a line straight at the theme's width, and a point as a round rect", () => {
    const line = render(ChartLine, {
      points: [
        [0, 10],
        [10, 20],
      ],
      paint: { role: "ref" },
      dash: "4 3",
    });
    expect(line).toContain('d="M0,10 L10,20"');
    expect(line).toContain('stroke-width="2"');
    expect(line).toContain('stroke-dasharray="4 3"');
    expect(line).toContain('data-part="series"');
    const point = render(ChartPoint, { cx: 10, cy: 10, paint: { ink: "" }, grow: true });
    expect(point).toContain('rx="4"');
    expect(point).toContain('width="8"');
    expect(point).toContain('data-part="point"');
  });

  it("fill under a line at the theme's area opacity, scaled by strength", () => {
    const area = render(ChartArea, {
      points: [
        [0, 10],
        [10, 20],
      ],
      baseY: 30,
      paint: { ink: "text-tone-success-fg" },
      strength: 0.6,
    });
    expect(area).toContain('d="M0,10 L10,20 L10,30 L0,30 Z"');
    expect(area).toMatch(/opacity="0\.06/);
    expect(area).toContain("text-tone-success-fg");
  });

  it("close a stacked band back along the series under it instead of the baseline", () => {
    const band = render(ChartArea, {
      points: [
        [0, 10],
        [10, 5],
      ],
      floor: [
        [0, 20],
        [10, 18],
      ],
      baseY: 30,
      paint: { series: 1 },
    });
    expect(band).toContain('d="M0,10 L10,5 L10,18 L0,20 Z"');
  });

  it("write a value beside its mark as a label part, in the muted ink", () => {
    const label = render(ChartLabel, { x: 5, y: 8, children: "21°" });
    expect(label).toContain('data-part="label"');
    expect(label).toContain('text-anchor="middle"');
    expect(label).toContain("fill-fg-muted");
    expect(label).toContain(">21°<");
  });

  it("draw an arc from twelve o'clock, round-capped only when asked, its track a grid part", () => {
    const arc = render(ChartArc, {
      cx: 10,
      cy: 10,
      r: 8,
      width: 2,
      paint: { role: "output" },
      length: 20,
      offset: -5,
    });
    expect(arc).toContain('data-part="series"');
    expect(arc).toContain('stroke-dasharray="20 ');
    expect(arc).toContain('stroke-dashoffset="-5"');
    expect(arc).toContain('transform="rotate(-90 10 10)"');
    expect(arc).not.toContain("stroke-linecap");
    const capped = render(ChartArc, {
      cx: 10,
      cy: 10,
      r: 8,
      width: 2,
      paint: { ink: "" },
      length: 20,
      round: true,
    });
    expect(capped).toContain('stroke-linecap="round"');
    const track = render(ChartArc, {
      cx: 10,
      cy: 10,
      r: 8,
      width: 2,
      paint: { ink: "" },
      track: true,
      trackOpacity: 0.3,
    });
    expect(track).toContain('data-part="grid"');
    expect(track).toContain('stroke-opacity="0.3"');
    expect(track).not.toContain("stroke-dasharray");
  });

  it("place a timeline bar where the chart says, in its slot's colour", () => {
    const html = render(TimelineBar, {
      paint: { series: 0 },
      place: { left: "10%", width: "5%" },
      className: "cursor-pointer",
    });
    expect(html).toContain("left:10%");
    expect(html).toContain(`background-color:${DEFAULT_CHART_STYLE.series[0]}`);
    expect(html).toContain('data-part="bar"');
    expect(html).not.toContain("box-shadow");
    expect(html).not.toContain("border-radius");
  });

  it("round only a timeline bar's free ends when a theme gives a radius, joined ends square", () => {
    expect(timelineRadius(3)).toBe(3);
    expect(timelineRadius(3, "end")).toBe("3px 0 0 3px");
    expect(timelineRadius(3, "start")).toBe("0 3px 3px 0");
    expect(timelineRadius(3, "both")).toBe(0);
  });

  it("paint a swatch the way its mark is painted", () => {
    expect(render(ChartSwatch, { paint: { role: "cacheRead" } })).toContain(
      `background-color:${DEFAULT_CHART_STYLE.cacheRead}`,
    );
    expect(
      render(ChartSwatch, { paint: { ink: "text-fg-subtle", swatch: "bg-fg-subtle" } }),
    ).toContain("bg-fg-subtle");
  });

  it("draw the grid, the axis labels and the cursor in the theme's chart inks", () => {
    expect(render(ChartGrid, { x1: 0, x2: 10, y: 5 })).toContain('class="stroke-chart-grid"');
    const axis = render(ChartAxis, { x: 0, y: 0, anchor: "end", children: "12" });
    expect(axis).toContain('class="fill-chart-axis"');
    expect(axis).toContain('data-part="axis"');
    expect(render(ChartCursor, { x: 5, y1: 0, y2: 10 })).toContain('class="stroke-line-emphasis"');
  });
});

describe("every chart in the package", () => {
  const CHARTS = [
    "components/charts/chart-frame/chart-frame.tsx",
    "components/charts/token-donut/token-donut.tsx",
    "components/charts/sparkline/sparkline.tsx",
    "components/charts/ring/ring.tsx",
    "components/charts/legend/legend.tsx",
    "components/charts/cartesian/plot-captions.tsx",
    "components/charts/cartesian/series-readout.tsx",
    "components/charts/cartesian/bar-chart.tsx",
    "components/charts/cartesian/hbar-chart.tsx",
    "components/charts/cartesian/line-chart.tsx",
    "components/charts/pie-chart/pie-chart.tsx",
    "components/charts/scatter-chart/scatter-chart.tsx",
    "components/charts/gauge/gauge.tsx",
  ];

  it("draws its marks through the primitives, never with its own shapes, paint or geometry", () => {
    const found: string[] = [];
    for (const rel of CHARTS) {
      const code = readFileSync(join(SRC_DIR, rel), "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
        "",
      );
      for (const pattern of [
        /<(?:rect|path|circle|line|polyline|polygon|ellipse|text)\b/,
        /\b(?:fill|stroke|strokeWidth|strokeDasharray|fillOpacity|strokeOpacity)=/,
        /backgroundColor/,
        /useChartStyle\(/,
      ]) {
        const hit = code.match(pattern);
        if (hit) found.push(`${rel}: ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });
});

describe("every A2UI block composed of charts", () => {
  const COMPOSITES = [
    "components/content/a2ui/chart-block.tsx",
    "components/content/a2ui/metrics-block.tsx",
    "components/content/a2ui/resources-block.tsx",
    "components/content/a2ui/weather-block.tsx",
    "components/content/a2ui/weather-hourly.tsx",
  ];
  /** The basic charts (under src/components/charts/), one of which a composite must draw through. */
  const BASIC_CHARTS = [
    "cartesian/bar-chart",
    "cartesian/hbar-chart",
    "cartesian/line-chart",
    "pie-chart/pie-chart",
    "scatter-chart/scatter-chart",
    "gauge/gauge",
    "sparkline/sparkline",
    "ring/ring",
    "legend/legend",
  ];
  /**
   * What else of the charts a composite may reach: the marks (a paint, a swatch), the frame's
   * width measure, and the bare frame's columns (to set art under a line). Never the geometry,
   * the data maths or the theme's chart style a chart keeps to itself.
   */
  const HELPERS = ["marks/marks", "chart-frame/chart-frame", "cartesian/plot-layout"];

  it("draws through a basic chart, with no SVG, paint or geometry of its own", () => {
    const found: string[] = [];
    for (const rel of COMPOSITES) {
      const code = readFileSync(join(SRC_DIR, rel), "utf8").replace(
        /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
        "",
      );
      const reached = [...code.matchAll(/from "(?:\.\.\/)+charts\/([^"]+)"/g)].map((m) => m[1]!);
      if (!reached.some((module) => BASIC_CHARTS.includes(module))) {
        found.push(`${rel}: draws through no basic chart`);
      }
      for (const module of reached) {
        if (!BASIC_CHARTS.includes(module) && !HELPERS.includes(module)) {
          found.push(`${rel}: reaches charts/${module}`);
        }
      }
      for (const pattern of [
        /<(?:svg|g|rect|path|circle|line|polyline|polygon|ellipse|text)\b/,
        /\b(?:fill|stroke|strokeWidth|strokeDasharray|fillOpacity|strokeOpacity)=/,
        /backgroundColor/,
        /useChartStyle\(/,
      ]) {
        const hit = code.match(pattern);
        if (hit) found.push(`${rel}: ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });
});
