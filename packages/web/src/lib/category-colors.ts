/**
 * Fixed color sequences for charts where color carries identity rather than
 * severity — one hue per series, never a judgement about it. Semantic status
 * colors live in lib/tone.ts and must not be borrowed here (and vice versa):
 * a categorical palette has to stay free to grow a hue without that reading as
 * a new state.
 *
 * Uses Tailwind class names instead of hex: dark mode needs a different shade
 * step, and only classes can track the html.dark toggle. (TOKEN_COLORS is one
 * blue hue family shared across light/dark shades, so it uses hex — the two
 * serve different purposes and aren't interchangeable.)
 */
/** Line series color: text drives stroke/fill="currentColor" for the whole series, swatch is for the legend. */
export interface SeriesColor {
  text: string;
  swatch: string;
}

/**
 * Fixed color sequence for chart series — the eval center's model x thinking-level
 * curves, the cost center's per-entity request stacks and rate lines. Adjacent
 * colors must pass color-vision-deficiency (CVD) separation checks and dark
 * shades must land within the brightness band. The violet / amber / sky / rose
 * ordering passes the dataviz validator in both modes (dark-mode amber / sky
 * dropped to the 600 step); sky vs. amber falls below 3:1 contrast on white,
 * backstopped by legend text and hover detail (identity never relies on color
 * alone). Its length is also the cap on how many entities a chart names before
 * folding the rest.
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

/**
 * The six parts of a model context, in the order the chat page's context panel lists them:
 * system prompt, tool definitions, user messages, model messages, tool requests, tool results.
 * Identity again, not severity — no part of a context is worse than another — so these belong
 * here and not in tone.ts, and they are a sequence of their own rather than a longer
 * SERIES_COLORS: that array's length is also the cost center's fold cap.
 *
 * **The order is part of the palette.** The legend rows are drawn in the same order as the bar
 * segments, so a reader only ever has to separate neighbours; this sequence is what clears the
 * adjacent-pair gates in both modes (worst adjacent ΔE 21.1 simulated for protanopia and
 * deuteranopia, 22.1 unsimulated; OKLab ×100). Reordering the parts means re-checking the
 * palette, not just moving rows. Six hues cannot also clear those gates for *arbitrary* pairs —
 * no six can — so the weakest non-neighbour pair here sits at ΔE 13 unsimulated, and the legend
 * carries every part's own value beside its name so colour never has to be read alone. Three
 * steps sit under 3:1 against white for the same reason.
 */
export const CONTEXT_PART_COLORS: readonly string[] = [
  "bg-sky-500 dark:bg-sky-600",
  "bg-amber-500 dark:bg-amber-600",
  "bg-fuchsia-500 dark:bg-fuchsia-600",
  "bg-rose-500",
  "bg-violet-500",
  "bg-emerald-500 dark:bg-emerald-600",
];

/**
 * The neutral a series wears when it stands for "the rest" rather than one
 * identity — the cost center's folded tail, the eval center's untagged runs.
 * Deliberately outside the sequence: it must not read as a fifth category.
 */
export const NEUTRAL_SERIES: SeriesColor = {
  text: "text-gray-400 dark:text-gray-500",
  swatch: "bg-gray-400 dark:bg-gray-500",
};
