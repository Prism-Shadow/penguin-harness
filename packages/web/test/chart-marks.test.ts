/**
 * The chart primitives (components/ui/chart): what each draws in the default theme — the
 * record the server snapshot of useChartStyle hands out, which is today's charts — and a guard
 * that every chart draws its marks through them.
 */
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ChartArea,
  ChartBar,
  ChartLine,
  ChartPoint,
  ChartSwatch,
  TimelineBar,
} from "../src/components/ui/chart";
import { barPath } from "../src/components/ui/chart/marks";
import { DEFAULT_CHART_STYLE } from "../src/lib/chart-style";
import { scanSources, sourceFile } from "./helpers/roots";

// Each primitive has its own props; the helper only renders one, so it takes any component.
const render = (type: (props: any) => ReactElement | null, props: object) =>
  renderToStaticMarkup(createElement(type, props));

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
      paint: { ink: "text-emerald-600" },
      strength: 0.6,
    });
    expect(area).toContain('d="M0,10 L10,20 L10,30 L0,30 Z"');
    expect(area).toMatch(/opacity="0\.06/);
    expect(area).toContain("text-emerald-600");
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
      render(ChartSwatch, { paint: { ink: "text-gray-400", swatch: "bg-gray-400" } }),
    ).toContain("bg-gray-400");
  });
});

describe("every chart", () => {
  const scan = scanSources();
  const CHARTS = [
    "features/usage/usage-charts.tsx",
    "features/usage/trend-chart.tsx",
    "features/usage/chart-svg.tsx",
    "components/ui/token-donut.tsx",
    "features/benchmark/score-sparkline.tsx",
    "features/agents/activity-sparkline.tsx",
    "features/traces/timeline-chart.tsx",
    "features/benchmark/benchmark-detail.tsx",
  ];

  it("draws its marks through the primitives, never with its own shapes, paint or geometry", () => {
    const found: string[] = [];
    for (const id of CHARTS) {
      const code = sourceFile(scan, `packages/web/src/${id}`).text.replace(
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
        if (hit) found.push(`${id}: ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });
});
