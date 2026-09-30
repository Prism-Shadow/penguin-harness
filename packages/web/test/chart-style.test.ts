/**
 * The charts' theme reading (lib/chart-style.ts) and the geometry it drives (chart-geom.ts):
 * tokens parse into the record with the default theme's values as the fallback for each one,
 * and the default values draw exactly what the charts drew before they read tokens.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_CHART_STYLE, readChartStyle, seriesStroke } from "../src/lib/chart-style";
import { curvePath, fitBarWidth, linePath, makeGeom } from "../src/features/usage/chart-geom";

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

  it("falls back token by token to the default theme's values", () => {
    expect(readChartStyle(reader({}))).toEqual(DEFAULT_CHART_STYLE);
    const odd = readChartStyle(
      reader({ "--ui-chart-curve": "wiggly", "--ui-chart-bar-fill": "x" }),
    );
    expect(odd.curve).toBe("linear");
    expect(odd.barFill).toBe(DEFAULT_CHART_STYLE.barFill);
  });

  it("cycles the palette past its last slot", () => {
    expect(seriesStroke(DEFAULT_CHART_STYLE, 8)).toBe(DEFAULT_CHART_STYLE.series[0]);
  });
});

describe("the geometry the tokens drive", () => {
  const g = makeGeom(3, 100, 640);

  it("draws the default theme exactly as before: straight lines, 60% bars", () => {
    expect(linePath(g, [0, 100, 50])).toBe(linePath(g, [0, 100, 50], "linear"));
    expect(linePath(g, [0, 100])).toMatch(/^M[\d.]+,[\d.]+ L[\d.]+,[\d.]+$/);
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
