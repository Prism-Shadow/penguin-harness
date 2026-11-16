/**
 * Each leaderboard entry's colour, the same in the table's dot, the Pareto point and the grid's
 * column head, and the medal tints of the first three ranks.
 *
 * The hues are the dataviz reference palette's categorical slots, each stepped once for the
 * light surface (white) and once for the dark one (gray-900), and a board takes the set its size
 * allows, checked with that skill's validator against both surfaces:
 * - up to three entries: blue, orange, aqua, which clear every pair in both themes, so the
 *   scatter can colour its points too;
 * - four: blue, yellow, magenta, green, the four-hue set that clears every pair in both themes
 *   (the dark protan pair sits in the 6–8 band, legal because every point has a label beside
 *   it or in its readout);
 * - five to eight: the palette's own order, which clears adjacent pairs (a list of rows, each
 *   dot next to its name) but not every pair, so the scatter keeps its two-tone frontier.
 * A ninth entry onwards is gray. A colour follows the entry's place in leaderboard.yaml, never
 * its rank, so filtering or re-sorting never repaints the survivors.
 */
import type { LeaderboardEntry } from "../../../lib/hub/types";

export interface EntryColour {
  dot: string;
  fill: string;
  stroke: string;
}

const SLOT = {
  blue: {
    dot: "bg-[#2a78d6] dark:bg-[#3987e5]",
    fill: "fill-[#2a78d6] dark:fill-[#3987e5]",
    stroke: "stroke-[#2a78d6] dark:stroke-[#3987e5]",
  },
  orange: {
    dot: "bg-[#eb6834] dark:bg-[#d95926]",
    fill: "fill-[#eb6834] dark:fill-[#d95926]",
    stroke: "stroke-[#eb6834] dark:stroke-[#d95926]",
  },
  aqua: {
    dot: "bg-[#1baf7a] dark:bg-[#199e70]",
    fill: "fill-[#1baf7a] dark:fill-[#199e70]",
    stroke: "stroke-[#1baf7a] dark:stroke-[#199e70]",
  },
  yellow: {
    dot: "bg-[#eda100] dark:bg-[#c98500]",
    fill: "fill-[#eda100] dark:fill-[#c98500]",
    stroke: "stroke-[#eda100] dark:stroke-[#c98500]",
  },
  magenta: {
    dot: "bg-[#e87ba4] dark:bg-[#d55181]",
    fill: "fill-[#e87ba4] dark:fill-[#d55181]",
    stroke: "stroke-[#e87ba4] dark:stroke-[#d55181]",
  },
  green: {
    dot: "bg-[#008300] dark:bg-[#008300]",
    fill: "fill-[#008300] dark:fill-[#008300]",
    stroke: "stroke-[#008300] dark:stroke-[#008300]",
  },
  violet: {
    dot: "bg-[#6250d6] dark:bg-[#9085e9]",
    fill: "fill-[#6250d6] dark:fill-[#9085e9]",
    stroke: "stroke-[#6250d6] dark:stroke-[#9085e9]",
  },
  red: {
    dot: "bg-[#e34948] dark:bg-[#e66767]",
    fill: "fill-[#e34948] dark:fill-[#e66767]",
    stroke: "stroke-[#e34948] dark:stroke-[#e66767]",
  },
} as const satisfies Record<string, EntryColour>;

const OTHER: EntryColour = {
  dot: "bg-gray-400 dark:bg-gray-500",
  fill: "fill-gray-400 dark:fill-gray-500",
  stroke: "stroke-gray-400 dark:stroke-gray-500",
};

const SMALL = [SLOT.blue, SLOT.orange, SLOT.aqua];
const FOUR = [SLOT.blue, SLOT.yellow, SLOT.magenta, SLOT.green];
const FULL = [
  SLOT.blue,
  SLOT.orange,
  SLOT.aqua,
  SLOT.yellow,
  SLOT.magenta,
  SLOT.green,
  SLOT.violet,
  SLOT.red,
];

export interface BoardColours {
  of: (entry: LeaderboardEntry) => EntryColour;
  /** Whether the scatter may tell its points apart by colour (every pair clears the checks). */
  scatter: boolean;
}

/** The colours of a board's entries, by their order in leaderboard.yaml. */
export function boardColours(entries: readonly LeaderboardEntry[]): BoardColours {
  const set = entries.length <= 3 ? SMALL : entries.length === 4 ? FOUR : FULL;
  const byKey = new Map(entries.map((entry, index) => [entry.key, set[index] ?? OTHER]));
  return { of: (entry) => byKey.get(entry.key) ?? OTHER, scatter: entries.length <= 4 };
}

/** The rank badge's tint: gold, silver and bronze for the first three, none after. */
export function medalOf(rank: number): string | undefined {
  return [
    "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200",
    "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-100",
    "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-200",
  ][rank - 1];
}
