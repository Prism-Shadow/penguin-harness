/**
 * The Web App's charts draw every mark through the package's chart primitives
 * (`@prismshadow/penguin-ui`: ChartBar, ChartLine, ChartArc, TimelineBar, …) and the charts built
 * on them (ChartFrame, Ring, Sparkline, TokenDonut), never with shapes, paint or geometry of their
 * own. What each primitive draws is the package's `chart-marks.test.ts`, which holds the
 * package's own charts to the same rule.
 *
 * A chart is any web module that imports one of those primitives, and the primitives are what the
 * UI package's `components/charts/` exports: both are read from the source, so a new chart is held
 * to the rule the moment it imports a primitive, and a moved one is still found.
 */
import { describe, expect, it } from "vitest";
import { expectEveryRootScanned, scanSources } from "./helpers/roots";

const CHARTS_DIR = "packages/ui/src/components/charts/";
const UI_IMPORT = /import\s+\{([^}]*)\}\s+from\s+"@prismshadow\/penguin-ui"/g;

describe("every chart", () => {
  const scan = scanSources([".ts", ".tsx"]);

  /** Every capitalized name the UI package's chart modules export: the primitives. */
  const primitives = new Set(
    scan.files
      .filter((file) => file.id.startsWith(CHARTS_DIR))
      .flatMap((file) =>
        [...file.text.matchAll(/^export (?:function|const) ([A-Z]\w*)/gm)].map((m) => m[1]!),
      ),
  );

  /** The web modules importing a primitive (a type-only import draws nothing). */
  const charts = scan.files.filter(
    (file) =>
      file.id.startsWith("packages/web/src/") &&
      [...file.text.matchAll(UI_IMPORT)].some((m) =>
        m[1]!
          .split(",")
          .map((name) => name.trim().split(/\s+as\s+/)[0]!)
          .some((name) => primitives.has(name)),
      ),
  );

  it("finds the primitives and the charts built on them", () => {
    expectEveryRootScanned(scan);
    // A scan that finds nothing would pass the rule below without checking anything.
    expect(primitives.size).toBeGreaterThan(0);
    expect(charts.length).toBeGreaterThan(0);
  });

  it("draws its marks through the primitives, never with its own shapes, paint or geometry", () => {
    const found: string[] = [];
    for (const file of charts) {
      const code = file.text.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "");
      for (const pattern of [
        /<(?:rect|path|circle|line|polyline|polygon|ellipse|text)\b/,
        /\b(?:fill|stroke|strokeWidth|strokeDasharray|fillOpacity|strokeOpacity)=/,
        /backgroundColor/,
        /useChartStyle\(/,
      ]) {
        const hit = code.match(pattern);
        if (hit) found.push(`${file.id}: ${hit[0]}`);
      }
    }
    expect(found).toEqual([]);
  });
});
