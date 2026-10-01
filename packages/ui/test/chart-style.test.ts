/**
 * The charts' theme reading (charts/chart-style.ts) and the geometry it drives (marks/geom.ts):
 * tokens parse into the record with the default record's values as the fallback for each one,
 * the fallback colours name the tokens themselves, and the default geometry draws exactly what
 * the charts drew before they read tokens.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CHART_STYLE,
  nextChartStyle,
  readChartStyle,
  seriesStroke,
} from "../src/components/charts/chart-style";
import { makeGeom, seriesPoints } from "../src/components/charts/chart-frame/chart-geom";
import { curvePath, fitBarWidth } from "../src/components/charts/marks/geom";

const reader = (tokens: Record<string, string>) => (name: string) => tokens[name] ?? "";

describe("readChartStyle", () => {
  it("reads every token a theme defines", () => {
    const style = readChartStyle(
      reader({
        "--ui-chart-1": "oklch(60% 0.2 290)",
        "--ui-chart-ref": " #f59e0b ",
        "--ui-chart-bar-fill": "0.8",
        "--ui-chart-bar-radius": "3px",
        "--ui-chart-line-width": "1.5px",
        "--ui-chart-point-radius": "3px",
        "--ui-chart-curve": " smooth",
        "--ui-chart-area-opacity": "0.2",
      }),
    );
    expect(style.series[0]).toBe("oklch(60% 0.2 290)");
    expect(style.ref).toBe("#f59e0b");
    expect(style).toMatchObject({
      barFill: 0.8,
      barRadius: 3,
      lineWidth: 1.5,
      pointRadius: 3,
      curve: "smooth",
      areaOpacity: 0.2,
    });
  });

  it("falls back token by token to the default record, whose colours are the tokens", () => {
    expect(readChartStyle(reader({}))).toEqual(DEFAULT_CHART_STYLE);
    expect(DEFAULT_CHART_STYLE.series[2]).toBe("var(--ui-chart-3)");
    expect(DEFAULT_CHART_STYLE.cacheRead).toBe("var(--ui-chart-cache-read)");
    const odd = readChartStyle(
      reader({ "--ui-chart-curve": "wiggly", "--ui-chart-bar-fill": "x" }),
    );
    expect(odd.curve).toBe("linear");
    expect(odd.barFill).toBe(DEFAULT_CHART_STYLE.barFill);
  });

  it("reads the bar outline and fill opacity, with 'series' meaning the bar's own colour", () => {
    expect(readChartStyle(reader({}))).toMatchObject({
      barStroke: 0,
      barStrokeColor: "series",
      barOpacity: 1,
    });
    expect(
      readChartStyle(
        reader({
          "--ui-chart-bar-stroke": "1px",
          "--ui-chart-bar-stroke-color": " oklch(40% 0.1 250) ",
          "--ui-chart-bar-opacity": "0.85",
        }),
      ),
    ).toMatchObject({ barStroke: 1, barStrokeColor: "oklch(40% 0.1 250)", barOpacity: 0.85 });
  });

  it("hands out the same record while nothing a chart draws with changed", () => {
    // <html> changes for reasons that are not the theme (a frame writing its height, the root
    // font size); a new record each time would re-render every chart, and a chart whose render
    // touches <html> would never settle.
    const first = readChartStyle(reader({}));
    const again = readChartStyle(reader({}));
    expect(again).not.toBe(first);
    expect(nextChartStyle(first, again)).toBe(first);
    const changed = readChartStyle(reader({ "--ui-chart-line-width": "1px" }));
    expect(nextChartStyle(first, changed)).toBe(changed);
    const recoloured = readChartStyle(reader({ "--ui-chart-3": "#123456" }));
    expect(nextChartStyle(first, recoloured)).toBe(recoloured);
    expect(nextChartStyle(null, first)).toBe(first);
  });

  it("cycles the palette past its last slot", () => {
    expect(seriesStroke(DEFAULT_CHART_STYLE, 8)).toBe(DEFAULT_CHART_STYLE.series[0]);
  });
});

describe("the geometry the tokens drive", () => {
  const g = makeGeom(3, 100, 640);

  it("draws the default theme exactly as before: straight lines, 60% bars", () => {
    const points = seriesPoints(g, [0, 100, 50]);
    expect(curvePath(points)).toBe(curvePath(points, "linear"));
    expect(curvePath(seriesPoints(g, [0, 100]))).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
    expect(fitBarWidth(20)).toBe(fitBarWidth(20, DEFAULT_CHART_STYLE.barFill));
  });

  it("widens bars with the fill share, within the cap", () => {
    expect(fitBarWidth(20, 0.8)).toBe(16);
    expect(fitBarWidth(20, 0.3)).toBe(6);
  });

  it("steps and smooths without leaving the data's range", () => {
    const points = [
      [0, 50],
      [10, 10],
      [20, 30],
    ] as const;
    expect(curvePath(points, "step")).toBe("M0,50 H5 V10 H10 H15 V30 H20");
    const smooth = curvePath(points, "smooth");
    expect(smooth.startsWith("M0,50 C")).toBe(true);
    const ys = [...smooth.matchAll(/[\d.]+,([\d.]+)/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(10);
    expect(Math.max(...ys)).toBeLessThanOrEqual(50);
  });
});
