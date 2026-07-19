/**
 * Category colors (for category-colored charts, e.g. the cost center's
 * "calls per Agent" pie chart): reuses the fixed five-color sequence from the
 * trace timeline bars — violet / sky / amber / rose / emerald (light shade
 * 500, dark shade 400 with reduced saturation) — extending to cyan / fuchsia
 * for more categories, then cycling.
 *
 * Uses Tailwind class names instead of hex: dark mode needs a different shade
 * step, and only classes can track the html.dark toggle.
 * (TOKEN_COLORS is the same blue hue family shared across light/dark shades,
 * so it uses hex — the two serve different purposes and aren't interchangeable.)
 */
export interface CategoryColor {
  /** SVG fill (pie chart slice). */
  fill: string;
  /** Legend swatch background. */
  swatch: string;
}

export const CATEGORY_COLORS: readonly CategoryColor[] = [
  { fill: "fill-violet-500 dark:fill-violet-400", swatch: "bg-violet-500 dark:bg-violet-400" },
  { fill: "fill-sky-500 dark:fill-sky-400", swatch: "bg-sky-500 dark:bg-sky-400" },
  { fill: "fill-amber-500 dark:fill-amber-400", swatch: "bg-amber-500 dark:bg-amber-400" },
  { fill: "fill-rose-500 dark:fill-rose-400", swatch: "bg-rose-500 dark:bg-rose-400" },
  { fill: "fill-emerald-500 dark:fill-emerald-400", swatch: "bg-emerald-500 dark:bg-emerald-400" },
  { fill: "fill-cyan-500 dark:fill-cyan-400", swatch: "bg-cyan-500 dark:bg-cyan-400" },
  { fill: "fill-fuchsia-500 dark:fill-fuchsia-400", swatch: "bg-fuchsia-500 dark:bg-fuchsia-400" },
];

/** Color for the i-th category (cycles once past the palette length). */
export function categoryColor(i: number): CategoryColor {
  return CATEGORY_COLORS[i % CATEGORY_COLORS.length]!;
}

/** Line series color: text drives stroke/fill="currentColor" for the whole series, swatch is for the legend. */
export interface SeriesColor {
  text: string;
  swatch: string;
}

/**
 * Fixed color sequence for line series (the eval center splits series by
 * model): maintained separately from CATEGORY_COLORS — adjacent line colors
 * must pass color-vision-deficiency (CVD) separation checks and dark shades
 * must land within the brightness band. The violet / amber / sky / rose
 * ordering passes the dataviz validator in both modes (dark-mode amber / sky
 * dropped to the 600 step); sky vs. amber falls below 3:1 contrast on white,
 * backstopped by legend text and detail tables (identity never relies on
 * color alone).
 */
export const SERIES_COLORS: readonly SeriesColor[] = [
  { text: "text-violet-500", swatch: "bg-violet-500" },
  { text: "text-amber-500 dark:text-amber-600", swatch: "bg-amber-500 dark:bg-amber-600" },
  { text: "text-sky-500 dark:text-sky-600", swatch: "bg-sky-500 dark:bg-sky-600" },
  { text: "text-rose-500", swatch: "bg-rose-500" },
];

/** Color for the i-th series (cycles once past the end; the legend is always present, so identity never relies on color alone). */
export function seriesColor(i: number): SeriesColor {
  return SERIES_COLORS[i % SERIES_COLORS.length]!;
}
