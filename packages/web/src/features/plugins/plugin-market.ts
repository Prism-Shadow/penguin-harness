/**
 * What the plugin market reads off its curation (GET /api/plugins/market) and the page's rows
 * (pure decisions, unit tested):
 *
 * - **The package a row is** (`rowPackage`): the curation names plugins by npm package name,
 *   never by the bare plugin name, since two scopes may share one. Its art (`artOf`), whether it
 *   is selected (`isSelected`) and the icon an uninstalled index row borrows from the curation
 *   (`marketIcon`) are looked up by it.
 * - **The carousel's slides** (`marketSlides`): the selected packages this page lists, in the
 *   curation's order, a name with no row skipped; and which of them may lead, in turn order.
 * - **When a row last changed** (`rowUpdated`): the newest dated version among a library
 *   plugin's Skills, hook package and workbenches, a server module's index `updatedAt`.
 * - **The ranking** (`popularityOf`, `rankRows`): the market's popularity figures, when the
 *   server sends any — all-time installs ("Popular") and installs this week ("Rising") per
 *   package — as the rows they rank, most first. The figures are placeholders today
 *   (`source: "placeholder"`) until a real install-count API replaces them; by the product's
 *   decision the page draws them without saying so, and reads a live source the same way.
 * - **The sorts** (`sortRows`): the curation's order, recency, how many Agents of this Project
 *   use a plugin, the name, and — only while popularity figures exist — installs
 *   (`availableSorts`; a stored "popular" reads as the curation's order without them).
 * - **What a tab shows** (`tabRows`): its rows under the search, and, when the search finds
 *   nothing in the tab, how many it finds across every plugin.
 *
 * The sort is remembered per browser (`penguin.pluginsSort`), like the grouping.
 */
import type {
  IconRef,
  MarketPopularity,
  PluginArt,
  PluginMarketResponse,
} from "@prismshadow/penguin-server/api";
import {
  rowMatches,
  type PluginGroup,
  type PluginRow,
  type PluginsPageStorage,
} from "./plugin-groups";
import { rowIcon } from "./plugin-marks";

/**
 * The npm package a row is: a server module's specifier, else the library plugin's package —
 * what the market's curation names it by.
 */
export function rowPackage(row: PluginRow): string | undefined {
  return row.module?.specifier ?? row.library?.package;
}

/** The curation's art for a row's package; null without a curation answer or without art. */
export function artOf(market: PluginMarketResponse | null, row: PluginRow): PluginArt | null {
  const name = rowPackage(row);
  return market === null || name === undefined ? null : (market.art[name] ?? null);
}

/** Whether the curation selects a row's package. */
export function isSelected(market: PluginMarketResponse | null, row: PluginRow): boolean {
  const name = rowPackage(row);
  return market !== null && name !== undefined && market.selected.includes(name);
}

/**
 * The icon a row is drawn with: its own (the library plugin's, else its index entry's), else
 * the raster icon the curation names for a package this server does not have yet (a remote
 * index row carries no icon of its own). Drawn as itself, never tinted.
 */
export function marketIcon(row: PluginRow, art: PluginArt | null): IconRef | undefined {
  const own = rowIcon(row);
  if (own !== undefined) return own;
  return art?.icon === undefined ? undefined : { url: art.icon.url, tint: false };
}

/** The carousel's slides: rows in the curation's order, and the indexes of those that may lead. */
export interface MarketSlides {
  rows: PluginRow[];
  /** Indexes into `rows` of the slides allowed to lead, in the curation's turn order. */
  leads: number[];
}

/**
 * The selected plugins this page lists, in the curation's order (a name no row carries is
 * skipped, never an error), and which of them may lead the carousel; none without a curation.
 */
export function marketSlides(
  market: PluginMarketResponse | null,
  rows: readonly PluginRow[],
): MarketSlides {
  if (market === null) return { rows: [], leads: [] };
  const byPackage = new Map<string, PluginRow>();
  for (const row of rows) {
    const name = rowPackage(row);
    if (name !== undefined && !byPackage.has(name)) byPackage.set(name, row);
  }
  const slides = [...new Set(market.selected)]
    .map((name) => byPackage.get(name))
    .filter((row): row is PluginRow => row !== undefined);
  const leads = [...new Set(market.hero)]
    .map((name) => slides.findIndex((row) => rowPackage(row) === name))
    .filter((index) => index >= 0);
  return { rows: slides, leads };
}

/**
 * A dated version (`YYYY.MM.DD.N`, or the older `YYYY-MM-DD.N`) as a number that orders the way
 * the dates do, the revision breaking a tie within a day; null for anything else.
 */
export function datedVersionTime(version: string | undefined): number | null {
  const m = /^(\d{4})[.-](\d{2})[.-](\d{2})\.(\d+)$/.exec(version ?? "");
  if (m === null) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + Number(m[4]);
}

/**
 * When a row last changed, in ms: the newest dated version among the library plugin's Skills,
 * its hook package and its workbenches, and a server module's index entry's `updatedAt` (in
 * seconds); null when the row carries no date at all. A package's npm version is not a date
 * and says nothing here.
 */
export function rowUpdated(row: PluginRow): number | null {
  const plugin = row.library;
  const versions = [
    ...(plugin?.skills ?? []).map((s) => s.version),
    plugin?.hookVersion,
    ...(plugin?.workbenches ?? []).map((w) => w.version),
  ];
  const times = versions.map(datedVersionTime).filter((t): t is number => t !== null);
  const updatedAt = row.module?.entry?.updatedAt;
  if (updatedAt !== undefined) times.push(updatedAt * 1000);
  return times.length === 0 ? null : Math.max(...times);
}

/** The popularity figures, when the market sends any for at least one package; else null. */
export function popularityOf(market: PluginMarketResponse | null): MarketPopularity | null {
  const popularity = market?.popularity;
  return popularity === undefined || Object.keys(popularity.items).length === 0 ? null : popularity;
}

/** Which figure a ranking orders by: all-time installs, or installs this week. */
export type RankingFigure = "installs" | "weekly";

/** One row of a ranking and the figure it is ranked by. */
export interface RankedRow {
  row: PluginRow;
  figure: number;
}

/**
 * The rows a ranking lists, most first (ties by title), at most `limit`: those whose package has
 * a figure above zero — a plugin nobody installed this week is not rising.
 */
export function rankRows(
  rows: readonly PluginRow[],
  popularity: MarketPopularity,
  by: RankingFigure,
  title: (row: PluginRow) => string,
  limit = 10,
): RankedRow[] {
  const ranked: RankedRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const name = rowPackage(row);
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);
    const figure = popularity.items[name]?.[by] ?? 0;
    if (figure > 0) ranked.push({ row, figure });
  }
  return ranked
    .sort((a, b) => b.figure - a.figure || title(a.row).localeCompare(title(b.row)))
    .slice(0, limit);
}

/** How the market's grid is ordered. */
export const PLUGIN_SORTS = ["featured", "recent", "used", "name", "popular"] as const;
export type PluginSort = (typeof PLUGIN_SORTS)[number];

/** The sorts the page offers: "popular" only while there are popularity figures to order by. */
export function availableSorts(popularity: MarketPopularity | null): PluginSort[] {
  return PLUGIN_SORTS.filter((sort) => sort !== "popular" || popularity !== null);
}

/** What the sorts read off a row besides the row itself, supplied by the page. */
export interface PluginSortInputs {
  /** What a row is called on screen: the tie-breaker of every sort. */
  title: (row: PluginRow) => string;
  /** The package names the curation selects, in its display order. */
  selected: readonly string[];
  /** How many Agents of this Project use a row. */
  usedBy: (row: PluginRow) => number;
  /** The popularity figures; without them "popular" orders as "featured". */
  popularity?: MarketPopularity | null;
}

/**
 * The rows in the market's order: `featured` puts the selected plugins first, in the curation's
 * order, then the rest by title; `recent` the newest first ({@link rowUpdated}), rows with no
 * date last by title; `used` the most used in this Project first, then by title; `name` by
 * title alone; `popular` the most installed first, rows with no figure last by title.
 */
export function sortRows(
  rows: readonly PluginRow[],
  sort: PluginSort,
  { title, selected, usedBy, popularity = null }: PluginSortInputs,
): PluginRow[] {
  const byTitle = (a: PluginRow, b: PluginRow) => title(a).localeCompare(title(b));
  const rank = (row: PluginRow) => {
    const at = selected.indexOf(rowPackage(row) ?? "");
    return at < 0 ? Number.POSITIVE_INFINITY : at;
  };
  const installs = (row: PluginRow) => popularity?.items[rowPackage(row) ?? ""]?.installs ?? 0;
  const compare: Record<PluginSort, (a: PluginRow, b: PluginRow) => number> = {
    featured: (a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra !== rb ? (ra < rb ? -1 : 1) : byTitle(a, b);
    },
    recent: (a, b) => {
      const ta = rowUpdated(a);
      const tb = rowUpdated(b);
      if (ta === tb) return byTitle(a, b);
      if (ta === null) return 1;
      if (tb === null) return -1;
      return tb - ta;
    },
    used: (a, b) => usedBy(b) - usedBy(a) || byTitle(a, b),
    name: byTitle,
    popular: (a, b) => installs(b) - installs(a) || byTitle(a, b),
  };
  return [...rows].sort(compare[sort === "popular" && popularity === null ? "featured" : sort]);
}

/** The "All" tab's key: no section of any grouping is called that. */
export const ALL_TAB = "*";

/** What the grid shows for a tab under a search. */
export interface TabView {
  /** The tab on show: the one asked for when the grouping has it, else All. */
  active: string;
  /** Its rows the search keeps, in the sections' order (the page sorts them). */
  rows: PluginRow[];
  /**
   * How many rows the search finds across every plugin when it finds none in this tab (0
   * otherwise, and always on All): the empty line offers those.
   */
  elsewhere: number;
}

/**
 * The rows of the tab `tab` names (`null` or a section the grouping does not have: All, every
 * listed row) that the search keeps.
 */
export function tabRows(
  sections: readonly PluginGroup[],
  tab: string | null,
  listed: readonly PluginRow[],
  query: string,
): TabView {
  const section = sections.find((s) => s.id === tab);
  const rows = (section?.rows ?? listed).filter((row) => rowMatches(row, query));
  const elsewhere =
    section !== undefined && rows.length === 0 && query.trim() !== ""
      ? listed.filter((row) => rowMatches(row, query)).length
      : 0;
  return { active: section?.id ?? ALL_TAB, rows, elsewhere };
}

export const PLUGINS_SORT_KEY = "penguin.pluginsSort";

/** The sort this browser last chose; selected-first when nothing usable is stored, or storage throws. */
export function initialPluginsSort(storage?: PluginsPageStorage): PluginSort {
  try {
    const stored = (storage ?? localStorage).getItem(PLUGINS_SORT_KEY);
    return PLUGIN_SORTS.find((sort) => sort === stored) ?? "featured";
  } catch {
    return "featured";
  }
}

/** Remembers the sort (best-effort: quota limits / private browsing fail silently). */
export function storePluginsSort(sort: PluginSort, storage?: PluginsPageStorage): void {
  try {
    (storage ?? localStorage).setItem(PLUGINS_SORT_KEY, sort);
  } catch {
    /* best-effort persistence */
  }
}
