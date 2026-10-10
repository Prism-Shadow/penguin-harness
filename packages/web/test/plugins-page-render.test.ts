/**
 * The Plugins page's pieces, rendered: the header actions with the grouping select, a card's
 * actions by kind and role, a server module's confirm, and the detail dialog's sections by kind.
 *
 * - A member sees the search box and the grouping select, and no Settings button; an admin sees
 *   Settings too, with its words.
 * - Choosing a grouping in the header regroups the cards that way.
 * - The grouping select shows the chosen grouping as its own phrase, and keeps an accessible name
 *   for what it groups.
 * - A server module's card offers an admin Install, or Remove once listed, each with its words;
 *   a member gets the card read-only — its status, and no way to change the server.
 * - A library plugin's card offers any member quick start and "manage installs".
 * - A card names its category, except inside that category's own section.
 * - Installing a server module names it and says it goes on the whole server, and then, after
 *   that, that the runs in progress in every Project stop.
 * - The detail dialog: a plugin of Skills shows its description and its files; a server module
 *   its description and README, and no files; one not on this server says the README comes
 *   with the install; a plugin that is both shows About, then Files.
 *
 * Rendered to static markup inside the locale provider, as `owner-only-actions.test.ts` renders
 * its cards. Static markup has no layout, so how the header row wraps on a phone is not here.
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
  type PluginCardProps,
} from "../src/features/plugins/plugin-card";
import {
  PluginDetailSections,
  type PluginDetailHead,
  type ReadmeState,
} from "../src/features/plugins/plugin-detail";
import {
  groupRows,
  type PluginGroupBy,
  type PluginRow,
} from "../src/features/plugins/plugin-groups";
import type { PluginStatus } from "../src/features/plugins/plugin-status";
import { PluginsHeaderActions } from "../src/features/plugins/plugins-page";
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

type HeaderProps = Parameters<typeof PluginsHeaderActions>[0];
const headerProps = (overrides: Partial<HeaderProps> = {}): HeaderProps => ({
  query: "",
  onQuery: () => undefined,
  groupBy: "category",
  onGroupBy: () => undefined,
  isAdmin: false,
  machinePicker: null,
  onOpenSettings: () => undefined,
  ...overrides,
});
const header = (isAdmin: boolean) => inLocale(PluginsHeaderActions, headerProps({ isAdmin }));

describe("the plugins page header", () => {
  it("offers a member the search box and the grouping select, and no Settings button", () => {
    const html = header(false);
    expect(html).toContain(`aria-label="${en.plugins.searchPlaceholder}"`);
    expect(buttonText(html, en.plugins.groupByLabel)).toBe(en.plugins.groupBy.category);
    expect(buttonWords(html)).not.toContain(en.plugins.openSettings);
  });

  it("offers an admin the search box, the grouping select and a Settings button that says what it is", () => {
    const html = header(true);
    expect(html).toContain(`aria-label="${en.plugins.searchPlaceholder}"`);
    expect(buttonText(html, en.plugins.groupByLabel)).toBe(en.plugins.groupBy.category);
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

describe("the grouping select", () => {
  const rows = [libraryRow, moduleRow("none")];
  const statusOf = (row: PluginRow): PluginStatus =>
    row.library !== undefined ? "installed" : "available";
  const categories = [
    { id: "office-productivity", title: "Office Productivity" },
    { id: "sandbox", title: "Agent Sandbox" },
  ];

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

  it("choosing to group by status in the header regroups the cards by status", () => {
    let chosen: PluginGroupBy = "category";
    const tree = PluginsHeaderActions(
      headerProps({
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

  it("shows the chosen grouping as its own phrase, under a name that says what it groups", () => {
    const html = inLocale(PluginsHeaderActions, headerProps({ groupBy: "status" }));
    expect(buttonText(html, en.plugins.groupByLabel)).toBe(en.plugins.groupBy.status);
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
