/**
 * The chart primitives (src/components/charts/marks): what each draws in the default theme — the
 * record the server snapshot of useChartStyle hands out — the chart inks they spell as tokens,
 * and a guard that the package's own charts draw every mark through them.
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
  ChartLine,
  ChartPoint,
  ChartSwatch,
  barPath,
} from "../src/components/charts/marks/marks";
import { TimelineBar } from "../src/components/charts/marks/timeline-bar";
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
