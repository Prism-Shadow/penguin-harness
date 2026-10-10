/**
 * The Plugins page's pieces, rendered: the header actions, the grouping and filter selects, a
 * card's actions by kind and role, a server module's confirm, and the detail dialog's sections
 * by kind.
 *
 * - A member sees the search box, and neither Import plugin nor Settings; an admin sees both,
 *   with their words.
 * - Choosing a grouping regroups the cards that way, and choosing a filter's value keeps only
 *   its cards until the option that filters nothing brings them all back.
 * - A chosen value shows as its own name, an idle filter as its option that filters nothing,
 *   and each select keeps an accessible name for what it groups or filters.
 * - A server module's card offers an admin Install, or Remove once listed, each with its words;
 *   a member gets the card read-only — its status, and no way to change the server.
 * - A library plugin's card offers any member quick start and "manage installs".
 * - A card names its category, except inside that category's own section; a package an admin
 *   installed on the server says so where a shipped one says "built in".
 * - Export offers a library plugin's package and a server module's on this server, and nothing
 *   for a module whose package is not here.
 * - Installing a server module names it and says it goes on the whole server, and then, after
 *   that, that the runs in progress in every Project stop.
 * - The detail dialog: a plugin of Skills shows its description and its files; a server module
 *   its description and README, and no files; one not on this server says the README comes
 *   with the install; a plugin that is both shows About, then Files.
 *
 * Rendered to static markup inside the locale provider, as `owner-only-actions.test.ts` renders
 * its cards. How the header row wraps on a narrow screen is PageHeader's, not this page's.
 */
import {
  createElement,
  isValidElement,
  type FunctionComponent,
  type ReactElement,
  type ReactNode,
} from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { PluginIndexEntry, PluginItem } from "@prismshadow/penguin-server/api";
import {
  ModuleApplyBody,
  PluginCard,
  pluginArchiveUrl,
  type PluginCardProps,
} from "../src/features/plugins/plugin-card";
import {
  PluginDetailSections,
  type PluginDetailHead,
  type ReadmeState,
} from "../src/features/plugins/plugin-detail";
import {
  NO_FILTERS,
  groupRows,
  rowMatches,
  type PluginFilters,
  type PluginGroupBy,
  type PluginRow,
} from "../src/features/plugins/plugin-groups";
import type { PluginStatus } from "../src/features/plugins/plugin-status";
import { PluginControls, PluginsHeaderActions } from "../src/features/plugins/plugins-page";
import { setActiveStrings } from "../src/lib/strings";
import { en } from "../src/lib/strings-en";
import { LocaleProvider } from "../src/state/locale";
import { stubLocalStorage } from "./helpers/storage";

beforeEach(() => {
  stubLocalStorage().setItem("penguin.lang", "en");
  setActiveStrings(en);
});

const inLocale = <P extends object>(child: FunctionComponent<P>, props: P) =>
  renderToStaticMarkup(createElement(LocaleProvider, null, createElement(child, props)));

/** The text a reader sees inside the button with this accessible name; undefined when absent. */
function buttonText(html: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`<button[^>]*aria-label="${escaped}"[^>]*>(.*?)</button>`, "s").exec(
    html,
  );
  return match?.[1]?.replace(/<[^>]+>/g, "").trim();
}

/** The words of every button in the markup, as a reader sees them. */
function buttonWords(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((m) => text(m[1]!).trim());
}

/** The text of the markup as a reader sees it: tags turned into spaces, entities decoded. */
const text = (html: string) =>
  html
    .replace(/<!-- -->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");

const header = (isAdmin: boolean) =>
  inLocale(PluginsHeaderActions, {
    query: "",
    onQuery: () => undefined,
    isAdmin,
    machinePicker: null,
    onOpenSettings: () => undefined,
    onImport: () => undefined,
  });

describe("the plugins page header", () => {
  it("offers a member the search box, and neither Import plugin nor Settings", () => {
    const html = header(false);
    expect(html).toContain(`aria-label="${en.plugins.searchPlaceholder}"`);
    expect(buttonWords(html)).not.toContain(en.plugins.importPlugin);
    expect(buttonWords(html)).not.toContain(en.plugins.openSettings);
  });

  it("offers an admin the search box, Import plugin and Settings, each saying what it is", () => {
    const html = header(true);
    expect(html).toContain(`aria-label="${en.plugins.searchPlaceholder}"`);
    expect(buttonWords(html)).toContain(en.plugins.importPlugin);
    expect(buttonWords(html)).toContain(en.plugins.openSettings);
  });
});

const BWRAP: PluginIndexEntry = {
  name: "@penguinharness/sandbox-bwrap",
  version: "0.2.3",
  description: "Bubblewrap sandbox backend.",
  descriptionZh: "Bubblewrap 沙箱后端。",
  shortDescription: "Linux: confine file writes.",
  authors: ["Prism Shadow"],
  license: "Apache-2.0",
  categories: ["sandbox"],
};

const moduleRow = (state: "none" | "active", shipped = true): PluginRow => ({
  key: "module:@penguinharness/sandbox-bwrap",
  name: "sandbox-bwrap",
  category: "sandbox",
  module: { specifier: BWRAP.name, entry: BWRAP, state, shipped },
});

const LIBRARY: PluginItem = {
  name: "data-analysis",
  description: "Data analysis.",
  version: "0.2.13",
  package: "@penguinharness/data-analysis",
  source: "builtin",
  skills: [{ name: "data-analysis", description: "", version: "2026.10.04.1" }],
  hooks: [],
};
const libraryRow: PluginRow = {
  key: "library:data-analysis",
  name: "data-analysis",
  category: "office-productivity",
  library: LIBRARY,
};

const card = (row: PluginRow, isAdmin: boolean, overrides: Partial<PluginCardProps> = {}) =>
  inLocale(PluginCard, {
    row,
    status: row.module?.state === "active" ? "installed" : "available",
    usage: row.library === undefined ? null : { usedBy: [], behind: [] },
    categoryTitle: "Agent Sandbox",
    showCategory: true,
    agents: [],
    installed: new Map(),
    canQuickStart: true,
    isAdmin,
    busy: false,
    blocked: false,
    onQuickStart: () => undefined,
    onDeletePlugin: () => Promise.resolve(),
    onToggleInstall: () => Promise.resolve(true),
    onUpdateOutdated: () => Promise.resolve(),
    onModuleApply: () => undefined,
    ...overrides,
  });

describe("a server module's card", () => {
  it("offers an admin Install, and Remove once it is listed, each with its words", () => {
    const available = card(moduleRow("none"), true);
    expect(buttonText(available, `${en.plugins.install} sandbox-bwrap`)).toBe(en.plugins.install);
    expect(buttonText(available, `${en.plugins.uninstall} sandbox-bwrap`)).toBeUndefined();
    const listed = card(moduleRow("active"), true);
    expect(buttonText(listed, `${en.plugins.uninstall} sandbox-bwrap`)).toBe(en.plugins.uninstall);
    expect(buttonText(listed, `${en.plugins.install} sandbox-bwrap`)).toBeUndefined();
  });

  it("shows a member its status and no way to change the server", () => {
    for (const state of ["none", "active"] as const) {
      const html = card(moduleRow(state), false);
      expect(buttonText(html, `${en.plugins.install} sandbox-bwrap`)).toBeUndefined();
      expect(buttonText(html, `${en.plugins.uninstall} sandbox-bwrap`)).toBeUndefined();
      expect(text(html)).toContain(
        state === "active" ? en.plugins.status.installed : en.plugins.status.available,
      );
    }
    // The card reads as every other: the short description and the version it ships at.
    expect(text(card(moduleRow("none"), false))).toContain("Linux: confine file writes.");
    expect(text(card(moduleRow("none"), false))).toContain("v0.2.3");
  });
});

describe("a library plugin's card", () => {
  it("offers any member quick start and managing its installs", () => {
    const html = card(libraryRow, false, { categoryTitle: "Office Productivity" });
    expect(buttonText(html, `${en.skills.manageInstall} data-analysis`)).toBe(
      en.skills.manageInstall,
    );
    expect(buttonText(html, `${en.skills.quickInvoke} data-analysis`)).toBe(en.skills.quickInvoke);
    expect(text(html)).toContain("v0.2.13");
  });
});

describe("a card's category", () => {
  it("is named on the card, except inside the category's own section", () => {
    const tagged = card(libraryRow, false, { categoryTitle: "Office Productivity" });
    expect(text(tagged)).toContain("Office Productivity");
    const inSection = card(libraryRow, false, {
      categoryTitle: "Office Productivity",
      showCategory: false,
    });
    expect(text(inSection)).not.toContain("Office Productivity");
    // The other tags stay.
    expect(text(inSection)).toContain(en.plugins.builtin);
  });
});

describe("where a plugin comes from", () => {
  it("tags a package an admin installed on the server, where a shipped one is built in", () => {
    const installed = card(
      {
        ...libraryRow,
        library: { ...LIBRARY, package: "@acme/data-analysis", source: "installed" },
      },
      false,
    );
    expect(text(installed)).toContain(en.plugins.installedOnServer);
    expect(text(installed)).not.toContain(en.plugins.builtin);
    const shipped = card(libraryRow, false);
    expect(text(shipped)).toContain(en.plugins.builtin);
    expect(text(shipped)).not.toContain(en.plugins.installedOnServer);
  });
});

describe("exporting a plugin", () => {
  it("offers a library plugin's package and a server module's on this server, and nothing for one not here", () => {
    expect(pluginArchiveUrl(libraryRow)).toBe("/api/plugins/data-analysis/archive");
    expect(pluginArchiveUrl(moduleRow("active"))).toBe(
      "/api/plugins/registry/archive?name=%40penguinharness%2Fsandbox-bwrap",
    );
    // Shipped with the build, so on this server even before anything lists it.
    expect(pluginArchiveUrl(moduleRow("none"))).not.toBeNull();
    expect(pluginArchiveUrl(moduleRow("none", false))).toBeNull();
  });
});

describe("installing a server module", () => {
  it("names it and says it goes on the whole server, then what it costs the runs in progress", () => {
    const html = text(inLocale(ModuleApplyBody, { install: true, name: "sandbox-bwrap" }));
    const body = html.indexOf(en.plugins.applyConfirmInstallBody("sandbox-bwrap"));
    const cost = html.indexOf(en.plugins.applyConfirmWarning(true));
    expect(en.plugins.applyConfirmInstallBody("sandbox-bwrap")).toContain("sandbox-bwrap");
    expect(body).toBeGreaterThanOrEqual(0);
    expect(cost).toBeGreaterThan(body);
  });
});

describe("the grouping and filter selects", () => {
  const rows = [libraryRow, moduleRow("none")];
  const statusOf = (row: PluginRow): PluginStatus =>
    row.library !== undefined ? "installed" : "available";
  const categories = [
    { id: "office-productivity", title: "Office Productivity" },
    { id: "sandbox", title: "Agent Sandbox" },
  ];
  type ControlsProps = Parameters<typeof PluginControls>[0];
  const props = (overrides: Partial<ControlsProps> = {}): ControlsProps => ({
    groupBy: "category",
    onGroupBy: () => undefined,
    filters: NO_FILTERS,
    onFilters: () => undefined,
    rows,
    statusOf,
    categories,
    ...overrides,
  });

  /** Every element in a tree of plain elements, depth first, its children (and lists of them) followed. */
  const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
    if (Array.isArray(node)) return node.flatMap(elements);
    if (!isValidElement(node)) return [];
    const element = node as ReactElement<Record<string, unknown>>;
    return [element, ...elements(element.props.children as ReactNode)];
  };

  /** Picks the option showing `words` in the select named `name`, as a reader choosing it would. */
  const choose = (tree: ReactNode, name: string, words: string) => {
    const select = elements(tree).find((el) => el.props["aria-label"] === name);
    const option = elements(select?.props.children as ReactNode).find(
      (el) => el.type === "option" && el.props.children === words,
    );
    if (select === undefined || option === undefined) throw new Error(`no "${words}" in ${name}`);
    (select.props.onChange as (e: { target: { value: unknown } }) => void)({
      target: { value: option.props.value },
    });
  };

  it("choosing to group by status regroups the cards by status", () => {
    let chosen: PluginGroupBy = "category";
    const tree = PluginControls(
      props({
        onGroupBy: (by) => {
          chosen = by;
        },
      }),
    );
    choose(tree, en.plugins.groupByLabel, en.plugins.groupBy.status);
    expect(groupRows(rows, statusOf, chosen, categories).map((group) => group.id)).toEqual([
      "installed",
      "available",
    ]);
  });

  it("choosing a category keeps only its cards, until the option that filters nothing brings them all back", () => {
    let filters: PluginFilters = NO_FILTERS;
    const onFilters = (next: PluginFilters) => {
      filters = next;
    };
    const kept = () =>
      rows.filter((row) => rowMatches(row, statusOf(row), filters, "")).map((row) => row.name);
    choose(PluginControls(props({ onFilters })), en.plugins.filterCategories, "Agent Sandbox");
    expect(kept()).toEqual(["sandbox-bwrap"]);
    choose(
      PluginControls(props({ filters, onFilters })),
      en.plugins.filterCategories,
      en.plugins.filterAllCategories,
    );
    expect(kept()).toEqual(["data-analysis", "sandbox-bwrap"]);
  });

  it("show a chosen value as its own name and an idle filter as the option that filters nothing", () => {
    /** What the select with this accessible name shows while closed. */
    const shown = (html: string, name: string) => buttonText(html, name);
    const idle = inLocale(PluginControls, props({ groupBy: "status" }));
    expect(shown(idle, en.plugins.groupByLabel)).toBe(en.plugins.groupBy.status);
    expect(shown(idle, en.plugins.filterCategories)).toBe(en.plugins.filterAllCategories);
    expect(shown(idle, en.plugins.filterKind)).toBe(en.plugins.filterAnyKind);
    expect(shown(idle, en.plugins.filterState)).toBe(en.plugins.filterAllStatuses);
    const picked = inLocale(
      PluginControls,
      props({ filters: { category: "sandbox", kind: "modules", status: "available" } }),
    );
    expect(shown(picked, en.plugins.filterCategories)).toBe("Agent Sandbox");
    expect(shown(picked, en.plugins.filterKind)).toBe(en.plugins.kindLabel.modules);
    expect(shown(picked, en.plugins.filterState)).toBe(en.plugins.status.available);
  });
});

const HEAD: PluginDetailHead = {
  status: "installed",
  statusHint: "",
  categoryTitle: "Agent Sandbox",
  usedBy: null,
};
const sections = (row: PluginRow, readme: ReadmeState) =>
  text(
    inLocale(PluginDetailSections, {
      row,
      head: HEAD,
      readme,
      files: row.library !== undefined ? createElement("p", null, "FILE-BROWSER") : null,
      locale: "en",
    }),
  );

describe("the detail dialog", () => {
  it("shows a plugin of Skills its description and its files, with no README to speak of", () => {
    const html = sections(libraryRow, { kind: "none" });
    expect(html).toContain("Data analysis.");
    expect(html).toContain(en.plugins.detailFiles);
    expect(html).toContain("FILE-BROWSER");
    expect(html).not.toContain(en.plugins.readmeAfterInstall);
  });

  it("shows a server module its description and README, and no files", () => {
    const html = sections(moduleRow("active"), { kind: "text", text: "# Requirements\n\nLinux." });
    expect(html).toContain("Bubblewrap sandbox backend.");
    expect(html).toContain("Requirements");
    expect(html).toContain(BWRAP.name);
    expect(html).not.toContain(en.plugins.detailFiles);
  });

  it("says a module not on this server shows its README once installed", () => {
    const html = sections(moduleRow("none", false), { kind: "after-install" });
    expect(html).toContain("Bubblewrap sandbox backend.");
    expect(html).toContain(en.plugins.readmeAfterInstall);
  });

  it("shows a plugin that is both its About section, then its files", () => {
    const both: PluginRow = { ...libraryRow, module: moduleRow("active").module };
    const html = sections(both, { kind: "text", text: "# Usage" });
    const about = html.indexOf(en.plugins.detailDescription);
    expect(about).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("Usage")).toBeGreaterThan(about);
    expect(html.indexOf(en.plugins.detailFiles)).toBeGreaterThan(html.indexOf("Usage"));
  });
});
