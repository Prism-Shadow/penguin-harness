/**
 * What the plugin market reads off its curation and the page's rows (features/plugins/
 * plugin-market.ts).
 *
 * - Given two packages of one bare name from two scopes, each row gets its own package's art and
 *   selection, never the other's.
 * - Given a remote index row with no icon of its own, it borrows the curation's icon, drawn as
 *   itself; a row with its own icon keeps it.
 * - "Selected first" puts the selected plugins first, in the curation's order, then the rest by
 *   title.
 * - "Recently updated" orders by the newest dated version among a plugin's Skills, hook package
 *   and workbenches, and a server module by its index entry's update time; a row with no date —
 *   an npm version is none — comes last.
 * - "Most used in this Project" orders by how many Agents use a plugin, ties by title; "Name" by
 *   title alone.
 * - Given a search that matches nothing in the tab on show, the tab reports how many it matches
 *   across every plugin; on All, or with no search, it reports none; a tab the grouping does not
 *   have reads as All.
 * - Only live install counts can order the results by popularity; an unavailable sort falls
 *   back to the curation's order.
 * - The sort is remembered in this browser, and storage it cannot use reads as "Selected first".
 */
import { beforeEach, describe, expect, it } from "vitest";
import type {
  MarketPopularity,
  PluginIndexEntry,
  PluginItem,
  PluginMarketResponse,
} from "@prismshadow/penguin-server/api";
import type { PluginGroup, PluginRow } from "../src/features/plugins/plugin-groups";
import {
  ALL_TAB,
  artOf,
  availableSorts,
  initialPluginsSort,
  isSelected,
  marketIcon,
  popularityOf,
  sortRows,
  storePluginsSort,
  tabRows,
  type PluginSort,
} from "../src/features/plugins/plugin-market";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";

beforeEach(() => {
  setActiveStrings(en);
});

/** A library plugin's row, its Skills at the given dated versions. */
function libraryRow(
  name: string,
  fields: Partial<PluginItem> & { skillVersions?: string[] } = {},
): PluginRow {
  const { skillVersions = [], ...rest } = fields;
  return {
    key: `library:${name}`,
    name,
    category: "office-productivity",
    library: {
      name,
      package: `@penguinharness/${name}`,
      source: "builtin",
      version: "0.2.18",
      description: `${name} does things`,
      skills: skillVersions.map((version, i) => ({
        name: `${name}-${i}`,
        description: "",
        version,
      })),
      hooks: [],
      mcpServers: [],
      ...rest,
    },
  };
}

/** A server module's row, as the index lists it. */
function moduleRow(specifier: string, entry: Partial<PluginIndexEntry> = {}): PluginRow {
  return {
    key: `module:${specifier}`,
    name: specifier.replace(/^@[^/]+\//, ""),
    category: "other",
    module: {
      specifier,
      entry: {
        name: specifier,
        description: `${specifier} module`,
        version: "1.0.0",
        license: "MIT",
        ...entry,
      } as PluginIndexEntry,
      state: "none",
      shipped: false,
    },
  };
}

const market = (fields: Partial<PluginMarketResponse>): PluginMarketResponse => ({
  hero: [],
  selected: [],
  art: {},
  source: "embedded",
  ...fields,
});

const names = (rows: readonly PluginRow[]) => rows.map((row) => row.name);
/** A title is the row's name here: these rows carry no display names. */
const order = (rows: readonly PluginRow[], sort: PluginSort, used: Record<string, number> = {}) =>
  names(
    sortRows(rows, sort, {
      title: (row) => row.name,
      selected: ["@penguinharness/goal", "@penguinharness/a2ui"],
      usedBy: (row) => used[row.name] ?? 0,
    }),
  );

describe("a row's art and selection", () => {
  it("are its own package's, even when another scope publishes the same name", () => {
    const ours = libraryRow("notes");
    const theirs = moduleRow("@acme/notes");
    const curation = market({
      selected: ["@acme/notes"],
      art: { "@penguinharness/notes": { cover: { url: "/ours.webp" } } },
    });
    expect(artOf(curation, ours)?.cover?.url).toBe("/ours.webp");
    expect(artOf(curation, theirs)).toBeNull();
    expect(isSelected(curation, theirs)).toBe(true);
    expect(isSelected(curation, ours)).toBe(false);
    expect(artOf(null, ours)).toBeNull();
  });

  it("borrow the curation's icon only for a row without one, drawn as itself", () => {
    const art = { icon: { url: "/api/plugins/market/asset?path=x/icon.png" } };
    expect(marketIcon(moduleRow("@acme/studio"), art)).toEqual({ url: art.icon.url, tint: false });
    const own = { url: "data:image/svg+xml,own", tint: true };
    expect(marketIcon(libraryRow("goal", { icon: own }), art)).toEqual(own);
    expect(marketIcon(moduleRow("@acme/studio"), null)).toBeUndefined();
  });
});

describe("the sorts", () => {
  const rows = [
    libraryRow("humanizer", { skillVersions: ["2026.10.04.1"] }),
    libraryRow("a2ui", { skillVersions: ["2026.09.01.1", "2026.11.04.1"] }),
    libraryRow("goal", { hookVersion: "2026.10.26.1" }),
    libraryRow("studio", { workbenches: [{ name: "studio", version: "2026.11.04.2" }] }),
    // An npm version is not a date: nothing says when this changed.
    libraryRow("bare"),
    // 2026-11-10 in seconds.
    moduleRow("@acme/sandbox", { updatedAt: Date.UTC(2026, 10, 10) / 1000 }),
  ];

  it("selected first: the curation's order, then the rest by title", () => {
    expect(order(rows, "featured")).toEqual([
      "goal",
      "a2ui",
      "bare",
      "humanizer",
      "sandbox",
      "studio",
    ]);
  });

  it("recently updated: the newest dated part or index update first, undated rows last", () => {
    expect(order(rows, "recent")).toEqual([
      "sandbox",
      "studio",
      "a2ui",
      "goal",
      "humanizer",
      "bare",
    ]);
  });

  it("most used in this Project, ties by title; or by name alone", () => {
    expect(order(rows, "used", { humanizer: 2, studio: 2, goal: 1 })).toEqual([
      "humanizer",
      "studio",
      "goal",
      "a2ui",
      "bare",
      "sandbox",
    ]);
    expect(order(rows, "name")).toEqual(["a2ui", "bare", "goal", "humanizer", "sandbox", "studio"]);
  });
});

describe("a tab under a search", () => {
  const goal = libraryRow("goal", { description: "Loop a session on an objective" });
  const a2ui = libraryRow("a2ui", { description: "Rich blocks in replies" });
  const sandbox = moduleRow("@acme/sandbox", { description: "A sandbox backend" });
  const listed = [goal, a2ui, sandbox];
  const sections: PluginGroup[] = [
    { id: "hooks", title: "Hooks", rows: [goal] },
    { id: "skills", title: "Skills", rows: [a2ui] },
    { id: "modules", title: "Server modules", rows: [sandbox] },
  ];

  it("that matches nothing in the tab reports how many it matches across every plugin", () => {
    const view = tabRows(sections, "hooks", listed, "blocks");
    expect(view).toEqual({ active: "hooks", rows: [], elsewhere: 1 });
  });

  it("reports nothing elsewhere on All, or without a search, and reads an unknown tab as All", () => {
    expect(tabRows(sections, null, listed, "nothing says this")).toMatchObject({
      active: ALL_TAB,
      rows: [],
      elsewhere: 0,
    });
    expect(tabRows(sections, "hooks", listed, "")).toMatchObject({ rows: [goal], elsewhere: 0 });
    expect(names(tabRows(sections, "by-colour", listed, "").rows)).toEqual(names(listed));
    expect(tabRows(sections, "by-colour", listed, "").active).toBe(ALL_TAB);
  });
});

describe("popularity", () => {
  const rows = ["a2ui", "browser", "goal", "humanizer"].map((name) => libraryRow(name));
  const popularity: MarketPopularity = {
    source: "live",
    generatedAt: "2026-11-17",
    items: {
      "@penguinharness/a2ui": { installs: 900, weekly: 40 },
      "@penguinharness/browser": { installs: 1200, weekly: 0 },
      "@penguinharness/goal": { installs: 300, weekly: 75 },
      "@penguinharness/gone": { installs: 5000, weekly: 500 },
    },
  };
  const title = (row: PluginRow) => row.name;

  it("offers the popular sort only with figures, and orders it as selected first without", () => {
    expect(
      popularityOf(market({ popularity: { ...popularity, source: "placeholder" } })),
    ).toBeNull();
    const curation = market({ popularity });
    expect(popularityOf(curation)).toBe(popularity);
    expect(availableSorts(popularityOf(curation))).toContain("popular");
    const order = (figures: MarketPopularity | null) =>
      names(
        sortRows(rows, "popular", {
          title,
          selected: ["@penguinharness/humanizer"],
          usedBy: () => 0,
          popularity: figures,
        }),
      );
    expect(order(popularity)).toEqual(["browser", "a2ui", "goal", "humanizer"]);

    const without = market({ popularity: { ...popularity, items: {} } });
    expect(popularityOf(without)).toBeNull();
    expect(popularityOf(market({}))).toBeNull();
    expect(availableSorts(null)).not.toContain("popular");
    expect(order(null)).toEqual(["humanizer", "a2ui", "browser", "goal"]);
  });
});

describe("the sort preference", () => {
  const memoryStorage = () => {
    const items = new Map<string, string>();
    return {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
  };

  it("is remembered in this browser, and storage it cannot use reads as selected first", () => {
    const storage = memoryStorage();
    expect(initialPluginsSort(storage)).toBe("featured");
    storePluginsSort("recent", storage);
    expect(initialPluginsSort(storage)).toBe("recent");

    const garbage = memoryStorage();
    garbage.setItem("penguin.pluginsSort", "trending");
    expect(initialPluginsSort(garbage)).toBe("featured");
    const blocked = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(() => storePluginsSort("name", blocked)).not.toThrow();
    expect(initialPluginsSort(blocked)).toBe("featured");
  });
});
