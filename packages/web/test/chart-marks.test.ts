/**
 * The Web App's charts draw every mark through the package's chart primitives
 * (`@prismshadow/penguin-ui`: ChartBar, ChartLine, ChartArc, TimelineBar, …) and the charts built
 * on them (ChartFrame, Ring, Sparkline, TokenDonut), never with shapes, paint or geometry of their
 * own. What each primitive draws is the package's `chart-marks.test.ts`, which holds the
 * package's own charts to the same rule.
 */
import { describe, expect, it } from "vitest";
import { scanSources, sourceFile } from "./helpers/roots";

describe("every chart", () => {
  const scan = scanSources();
  const CHARTS = [
    "features/usage/usage-charts.tsx",
    "features/usage/trend-chart.tsx",
    "features/traces/timeline-chart.tsx",
    "features/benchmark/benchmark-detail.tsx",
    "features/company/finance-gauge.tsx",
    "features/company/shared.tsx",
    "features/chat/context-gauge.tsx",
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
