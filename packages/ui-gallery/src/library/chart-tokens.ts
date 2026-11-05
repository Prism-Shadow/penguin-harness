/**
 * The chart tokens the 图表 page tables for the current theme: the palette (the eight series
 * slots, the reference line, the three token kinds, the grid and axis inks) and the geometry
 * (bar fill, radius, outline and opacity, line width, point radius, curve, area opacity). Pure
 * over a reader of custom properties, so the list and the reading are unit-tested; the board
 * reads them off the frame root's computed style, which is the theme under test.
 */

export const CHART_PALETTE_TOKENS = [
  "--ui-chart-1",
  "--ui-chart-2",
  "--ui-chart-3",
  "--ui-chart-4",
  "--ui-chart-5",
  "--ui-chart-6",
  "--ui-chart-7",
  "--ui-chart-8",
  "--ui-chart-ref",
  "--ui-chart-cache-read",
  "--ui-chart-cache-write",
  "--ui-chart-output",
  "--ui-chart-grid",
  "--ui-chart-axis",
] as const;
export type ChartPaletteToken = (typeof CHART_PALETTE_TOKENS)[number];

export const CHART_GEOMETRY_TOKENS = [
  "--ui-chart-bar-fill",
  "--ui-chart-bar-radius",
  "--ui-chart-bar-stroke",
  "--ui-chart-bar-stroke-color",
  "--ui-chart-bar-opacity",
  "--ui-chart-line-width",
  "--ui-chart-point-radius",
  "--ui-chart-curve",
  "--ui-chart-area-opacity",
] as const;
export type ChartGeometryToken = (typeof CHART_GEOMETRY_TOKENS)[number];

export type ChartToken = ChartPaletteToken | ChartGeometryToken;

export interface ChartTokenRow<T extends ChartToken = ChartToken> {
  name: T;
  /** The computed value, trimmed; empty when the theme leaves the token undefined. */
  value: string;
}

/** Every token's computed value, in the tables' order, from a reader such as `getPropertyValue`. */
export function readChartTokens(read: (name: string) => string): {
  palette: ChartTokenRow<ChartPaletteToken>[];
  geometry: ChartTokenRow<ChartGeometryToken>[];
} {
  return {
    palette: CHART_PALETTE_TOKENS.map((name) => ({ name, value: read(name).trim() })),
    geometry: CHART_GEOMETRY_TOKENS.map((name) => ({ name, value: read(name).trim() })),
  };
}
