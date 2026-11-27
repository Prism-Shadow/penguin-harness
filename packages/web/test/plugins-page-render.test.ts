/**
 * The Plugins page's pieces, rendered: the header actions with the grouping select, a card's
 * actions by kind and role, a server module's confirm, and the detail dialog's sections by kind.
 *
 * - A member sees the search box, and neither Import plugin nor
 *   Settings; an admin sees, after it, Import plugin and then Settings, with their words.
 * - Choosing a grouping in the header regroups the cards that way.
 * - The grouping select shows the chosen grouping as its own phrase, and keeps an accessible name
 *   for what it groups.
 * - A server module's card offers an admin Install, or Remove once listed, each with its words;
 *   a member gets the card read-only — its status, and no way to change the server.
 * - A library plugin's card offers any member quick start and "Install on Agent".
 * - A card names its category, except inside that category's own section; a package an admin
 *   installed on the server says so where a shipped one says "built in".
 * - Export offers a library plugin's package and a server module's on this server, and nothing
 *   for a module whose package is not here.
 * - Installing a server module names it and says it goes on the whole server, and then, after
 *   that, that the runs in progress in every Project stop.
 * - The detail dialog: a plugin of Skills shows its description and its files; a server module
 *   its description and README, and no files; one not on this server says the README comes
 *   with the install; a plugin that is both shows About, then Files.
 * - A plugin whose package carries no description shows the placeholder on its card and in its
 *   dialog, and the card still opens the dialog, files and all. A shipped package no index
 *   knows still says it ships with the build instead.
 * - A plugin whose package gives a display name shows it on the card and as the dialog's title
 *   (in the UI language), and the dialog names the package beneath it; without one, the name
 *   stands and no package line is added. A module-only plugin uses its registry titles on
 *   its card, in the dialog and when searching, with the same language fallback.
 * - The dialog lists the package's author and license — a server module's from its index entry —
 *   and links only to what a browser can safely open, in a new tab: an https homepage and a
 *   `git+https://….git` repository link to their pages, a `javascript:` repository is no link,
 *   and a package carrying none of these links nowhere.
 * - A package's URL as package.json writes it (`git+https://….git`, `github:o/r`) becomes the
 *   page it names; anything not http(s) becomes no link.
 * - A plugin's MCP servers: the dialog lists each with its transport and target, a mark naming
 *   the values it needs (by their labels) and one saying it needs a sign-in; a stdio server's
 *   mark names the command it runs on this server.
 * - Installing a plugin with a stdio server asks first, and the question shows the command; an
 *   install of several plugins at once (a bulk update, a new Agent's plugins) names each plugin
 *   that runs one, with its commands.
 * - In the install flow, an Agent whose copy waits for vault values says which; its owner gets
 *   Set up, a member is told the owner sets them. Only the owner may uninstall: a member reads
 *   "Installed" with no Uninstall behind it. Saving writes the vault with every existing
 *   key kept, the new values added, an empty field left out.
 * - The compatibility notice counts the affected plugins.
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
  InstallRow,
  ModuleApplyBody,
  PluginCard,
  pluginArchiveUrl,
  type PluginCardProps,
} from "@prismshadow/penguin-library-plugin/web/plugin-card";
import {
  StdioDisclosure,
  StdioInstallBody,
  setUpVaultEntries,
} from "@prismshadow/penguin-library-plugin/web/plugin-mcp";
import {
  PluginDetailSections,
  type PluginDetailHead,
  type ReadmeState,
} from "@prismshadow/penguin-library-plugin/web/plugin-detail";
import {
  groupRows,
  rowMatches,
  type PluginGroupBy,
  type PluginRow,
} from "@prismshadow/penguin-library-plugin/web/plugin-groups";
import {
  PluginStatusMark,
  rowTitle,
  webLink,
} from "@prismshadow/penguin-library-plugin/web/plugin-marks";
import type { PluginStatus } from "@prismshadow/penguin-library-plugin/web/plugin-status";
import {
  IncompatibleNotice,
  PluginsHeaderActions,
  PluginsListControls,
} from "@prismshadow/penguin-library-plugin/web/plugins-page";
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

/** Every element in a tree of plain elements, depth first, its children (and lists of them) followed. */
const elements = (node: ReactNode): ReactElement<Record<string, unknown>>[] => {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const element = node as ReactElement<Record<string, unknown>>;
  return [element, ...elements(element.props.children as ReactNode)];
};

type HeaderProps = Parameters<typeof PluginsHeaderActions>[0];
const headerProps = (overrides: Partial<HeaderProps> = {}): HeaderProps => ({
  query: "",
  onQuery: () => undefined,
  isAdmin: false,
  machinePicker: null,
  onOpenSettings: () => undefined,
  onImport: () => undefined,
  ...overrides,
});
const header = (isAdmin: boolean) => inLocale(PluginsHeaderActions, headerProps({ isAdmin }));

describe("the plugins page header", () => {
  it("offers a member the search box, and neither Import plugin nor Settings", () => {
    const html = header(false);
    expect(html).toContain(`aria-label="${en.plugins.searchPlaceholder}"`);
    expect(html).not.toContain(`aria-label="${en.plugins.groupByLabel}"`);
    expect(buttonWords(html)).not.toContain(en.plugins.importPlugin);
    expect(buttonWords(html)).not.toContain(en.plugins.openSettings);
  });

  it("offers an admin, after the search box, Import plugin and then Settings", () => {
    const html = header(true);
    const search = html.indexOf(`aria-label="${en.plugins.searchPlaceholder}"`);
    expect(search).toBeGreaterThanOrEqual(0);
    expect(buttonWords(html)).toEqual([en.plugins.importPlugin, en.plugins.openSettings]);
  });
});

it("counts incompatible plugins while keeping the catalog visible", () => {
  expect(text(inLocale(IncompatibleNotice, { unsatisfied: 2 }))).toContain(
    en.plugins.unsatisfiedNotice(2),
  );
  expect(inLocale(IncompatibleNotice, { unsatisfied: 0 })).toBe("");
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
  mcpServers: [],
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
    targets: [],
    installed: new Map(),
    canQuickStart: true,
    isAdmin,
    busy: false,
    blocked: false,
    onQuickStart: () => undefined,
    onToggleInstall: () => Promise.resolve(true),
    onUpdateOutdated: () => Promise.resolve(),
    onModuleApply: () => undefined,
    isOwner: false,
    projectId: null,
    onMcpChanged: () => undefined,
    ...overrides,
  });

describe("a removable workbench plugin", () => {
  it("does not identify bundled or manually installed workbenches as built in", () => {
    for (const source of ["builtin", "installed"] as const) {
      const html = card(
        {
          ...libraryRow,
          library: { ...LIBRARY, source, workbenches: [{ name: "sample", version: "1.0.0" }] },
        },
        true,
      );
      expect(html).not.toContain(en.plugins.builtin);
    }
    expect(card({ ...libraryRow, library: { ...LIBRARY, source: "builtin" } }, true)).toContain(
      en.plugins.builtin,
    );
  });
});

describe("a server module's card", () => {
  const words = en.plugins.installModel;
  it("offers an admin Install on server for a market package, and leaves uninstalling to the detail", () => {
    const available = card(moduleRow("none", false), true);
    expect(buttonText(available, `${words.installServer} sandbox-bwrap`)).toBe(words.installServer);
    const listed = card(moduleRow("active", false), true);
    for (const html of [available, listed]) {
      expect(buttonText(html, `${words.uninstallServer} sandbox-bwrap`)).toBeUndefined();
    }
    expect(buttonText(listed, `${words.installServer} sandbox-bwrap`)).toBeUndefined();
  });

  it("offers an admin enabling a module the build ships, never uninstalling it, and leaves disabling to the detail", () => {
    const available = card(moduleRow("none"), true);
    expect(buttonText(available, `${words.enableModule} sandbox-bwrap`)).toBe(words.enableModule);
    const listed = card(moduleRow("active"), true);
    expect(buttonText(listed, `${words.disableModule} sandbox-bwrap`)).toBeUndefined();
    for (const html of [available, listed]) {
      expect(buttonText(html, `${words.uninstallServer} sandbox-bwrap`)).toBeUndefined();
      expect(buttonText(html, `${words.installServer} sandbox-bwrap`)).toBeUndefined();
    }
  });

  it("holds a member's server control on a market package, saying only an admin changes the server", () => {
    const row = moduleRow("none", false);
    row.module!.entry = {
      ...BWRAP,
      offline: { version: BWRAP.version, library: false, modules: true },
    };
    const html = card(row, false);
    const tag =
      new RegExp(`<button[^>]*aria-label="${words.installServer} sandbox-bwrap"[^>]*>`).exec(
        html,
      )?.[0] ?? "";
    expect(tag).toContain('disabled=""');
    expect(tag).toContain(`data-tooltip="${words.adminOnly}"`);
  });

  it("shows a member its status and no way to change a module the build ships", () => {
    for (const state of ["none", "active"] as const) {
      const html = card(moduleRow(state), false);
      expect(buttonText(html, `${words.enableModule} sandbox-bwrap`)).toBeUndefined();
      expect(buttonText(html, `${words.disableModule} sandbox-bwrap`)).toBeUndefined();
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
  it("offers any member quick start and installing it on Agents", () => {
    const html = card(libraryRow, false, { categoryTitle: "Office Productivity" });
    expect(buttonText(html, `${en.plugins.installModel.installAgent} data-analysis`)).toBe(
      en.plugins.installModel.installAgent,
    );
    expect(buttonText(html, `${en.skills.quickInvoke} data-analysis`)).toBe(en.skills.quickInvoke);
    expect(text(html)).toContain("v0.2.13");
  });
});

describe("the market’s versioned actions", () => {
  const current = { marketCard: true, currentAgentId: "alice", showPackageUpdates: true };
  it("offers a verified package update before applying the new resources to the Agent", () => {
    const newer = {
      ...BWRAP,
      version: "1.1.0",
      localInstall: { version: "1.0.0", libraryOnly: true, updateAvailable: true },
    };
    const row = {
      ...libraryRow,
      module: { specifier: newer.name, state: "none" as const, shipped: false, entry: newer },
    };
    const html = card(row, true, current);
    expect(buttonWords(html).slice(-2)).toEqual(["Update to v1.1.0", "Quick start"]);
    expect(html).toContain('class="showcase-card-version">v1.0.0</span>');
    expect(html).toContain(en.plugins.quickStartAfterInstall);
  });
  it("offers to update a reachable Agent other than the current one", () => {
    for (const layout of ["cover", "row"] as const) {
      const usage = { usedBy: ["bob"], behind: ["bob"] };
      expect(buttonWords(card(libraryRow, true, { ...current, layout, usage })).at(-2)).toBe(
        en.skills.updateAction,
      );
      expect(
        buttonWords(
          card(libraryRow, true, { ...current, layout, usage: { ...usage, lastSeen: ["bob"] } }),
        ).at(-2),
      ).toBe(en.plugins.marketAgentInstalls(1));
    }
  });
  it("only enables a demo on the Agent that carries it", () => {
    const installed = new Map([
      [
        "alice",
        { skills: new Map([["data-analysis", "2026.10.04.1"]]), hooks: new Map(), mcp: new Map() },
      ],
    ]);
    const usage = { usedBy: ["alice"], behind: [], lastSeen: [] };
    const ready = card(libraryRow, false, { ...current, installed, usage });
    expect(buttonWords(ready).slice(-2)).toEqual(["Installed on 1 Agent", "Quick start"]);
    expect(ready).toContain(en.plugins.quickStartHint);
    expect(ready).toContain('class="showcase-card-version">v0.2.13</span>');
    // Another Agent has it: the count alone, never Install beside it; the demo waits.
    const other = card(libraryRow, false, { ...current, installed, usage, currentAgentId: "bob" });
    expect(buttonWords(other).slice(-2)).toEqual(["Installed on 1 Agent", "Quick start"]);
    expect(other).toContain(en.plugins.quickStartAfterInstall);
  });
  it("distinguishes a running server plugin from a shipped or downloaded package", () => {
    for (const layout of ["row", "cover"] as const) {
      const props = { ...current, layout };
      expect(buttonWords(card(moduleRow("active"), true, props)).at(-2)).toBe(
        "Installed on server",
      );
      expect(buttonWords(card(moduleRow("none"), true, props)).at(-2)).toBe("Install");
      expect(buttonWords(card(libraryRow, true, props)).at(-2)).toBe("Install");
      const usage = { usedBy: ["alice", "bob"], behind: [], lastSeen: [] };
      expect(buttonWords(card(libraryRow, true, { ...props, usage })).at(-2)).toBe(
        "Installed on 2 Agents",
      );
    }
  });
  it("keeps a workbench with no example readable in both layouts", () => {
    const row = {
      ...libraryRow,
      library: { ...LIBRARY, skills: [], workbenches: [{ name: "slides", version: "1" }] },
    };
    for (const layout of ["cover", "row"] as const) {
      const html = card(row as PluginRow, true, { ...current, layout });
      expect(html).toContain(en.plugins.noQuickAction);
      expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Quick start/);
    }
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
    const html = text(inLocale(ModuleApplyBody, { mode: "install", name: "sandbox-bwrap" }));
    const body = html.indexOf(en.plugins.applyConfirmInstallBody("sandbox-bwrap"));
    const cost = html.indexOf(en.plugins.applyConfirmWarning(true));
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

  const controls = (overrides: Partial<Parameters<typeof PluginsListControls>[0]> = {}) => ({
    groupBy: "category" as PluginGroupBy,
    onGroupBy: () => undefined,
    sort: "featured" as const,
    sorts: ["featured", "recent", "used", "name"] as const,
    onSort: () => undefined,
    locale: "en" as const,
    ...overrides,
  });

  it("choosing to group by status at the tab row's end regroups the cards by status", () => {
    let chosen: PluginGroupBy = "category";
    const tree = PluginsListControls(
      controls({
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
    const html = inLocale(PluginsListControls, controls({ groupBy: "status" }));
    expect(buttonText(html, en.plugins.groupByLabel)).toBe(en.plugins.groupBy.status);
  });
});

const HEAD: PluginDetailHead = {
  status: createElement(PluginStatusMark, { status: "installed", hint: "" }),
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
    // The package name as it reads: the facts row lets a line break after the scope's slash.
    expect(html.replace(/\/ /g, "/")).toContain(BWRAP.name);
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

describe("a plugin with no description", () => {
  const bare: PluginRow = { ...libraryRow, library: { ...LIBRARY, description: "" } };

  it("shows the placeholder on its card, which still opens its dialog, and in the dialog", () => {
    const html = card(bare, false);
    // The placeholder sits in the card's body, the button that opens the dialog.
    expect(buttonWords(html).some((w) => w.includes(en.plugins.noDescription))).toBe(true);
    const dialog = sections(bare, { kind: "none" });
    expect(dialog).toContain(en.plugins.noDescription);
    expect(dialog).toContain("FILE-BROWSER");
  });

  it("leaves a shipped package no index knows saying it ships with the build, not the placeholder", () => {
    const unknown: PluginRow = {
      key: "module:@penguinharness/sandbox-dsh",
      name: "sandbox-dsh",
      category: "sandbox",
      module: {
        specifier: "@penguinharness/sandbox-dsh",
        entry: undefined,
        state: "none",
        shipped: true,
      },
    };
    for (const html of [text(card(unknown, false)), sections(unknown, { kind: "none" })]) {
      expect(html).toContain(en.plugins.shippedNoEntry);
      expect(html).not.toContain(en.plugins.noDescription);
    }
  });
});

describe("a plugin's display name", () => {
  const titled: PluginRow = {
    key: "library:notes",
    name: "notes",
    category: "other",
    library: {
      ...LIBRARY,
      name: "notes",
      title: "Notes Pro",
      titleZh: "笔记专业版",
      package: "@acme/notes",
      source: "installed",
    },
  };

  it("shows on the card and as the dialog's title, with the package name beneath it", () => {
    const onCard = text(card(titled, false));
    expect(onCard).toContain("Notes Pro");
    expect(onCard).not.toMatch(/\bnotes\b/);
    expect(rowTitle(titled, "en")).toBe("Notes Pro");
    expect(rowTitle(titled, "zh")).toBe("笔记专业版");
    // Counted as the name reads: the facts row lets a line break after the scope's slash.
    const times = (text: string, part: string) => text.replace(/\/ /g, "/").split(part).length - 1;
    // The package is the line under a display name, and a row of the facts column.
    expect(times(sections(titled, { kind: "none" }), "@acme/notes")).toBe(2);
    // Without a display name the plugin's name stands, and no package line joins it: the
    // package is named in the facts column alone.
    expect(rowTitle(libraryRow, "en")).toBe("data-analysis");
    expect(times(sections(libraryRow, { kind: "none" }), LIBRARY.package)).toBe(1);
  });
});

describe("a module-only plugin's display name", () => {
  it("uses and searches the registry titles, falling back to English or the package name", () => {
    const row: PluginRow = {
      key: "module:@acme/runner",
      name: "runner",
      category: "sandbox",
      module: {
        specifier: "@acme/runner",
        state: "none",
        shipped: true,
        entry: {
          name: "@acme/runner",
          version: "1",
          description: "",
          authors: [],
          license: "MIT",
          title: "Task runner",
          titleZh: "任务执行器",
        },
      },
    };
    expect(text(card(row, false))).toContain("Task runner");
    expect(rowTitle(row, "zh")).toBe("任务执行器");
    expect(rowMatches(row, "TASK RUNNER")).toBe(true);
    expect(rowMatches(row, "任务执行器")).toBe(true);
    delete row.module!.entry!.titleZh;
    expect(rowTitle(row, "zh")).toBe("Task runner");
    delete row.module!.entry!.title;
    expect(rowTitle(row, "en")).toBe("runner");
    row.module!.entry = undefined;
    expect(rowTitle(row, "zh")).toBe("runner");
  });
});

describe("the package's own details in the dialog", () => {
  /** Every link in the markup: where it goes, its name, and whether it opens apart from this page. */
  const links = (html: string) =>
    [...html.matchAll(/<a\s([^>]*)>/g)].map((m) => ({
      href: /href="([^"]*)"/.exec(m[1]!)?.[1],
      name: /aria-label="([^"]*)"/.exec(m[1]!)?.[1],
      apart: m[1]!.includes('target="_blank"') && m[1]!.includes('rel="noopener noreferrer"'),
    }));
  const details = (row: PluginRow) =>
    inLocale(PluginDetailSections, {
      row,
      head: HEAD,
      readme: { kind: "none" },
      files: null,
      locale: "en",
    });

  it("shows the author and license, and links only what a browser can safely open, in a new tab", () => {
    const html = details({
      ...libraryRow,
      library: {
        ...LIBRARY,
        author: "Acme Labs",
        license: "MIT",
        homepage: "https://acme.example/notes",
        repository: "javascript:alert(1)",
      },
    });
    // Each in its own row of the facts column, under its label.
    expect(text(html)).toContain(`${en.plugins.fact.author} Acme Labs`);
    expect(text(html)).toContain(`${en.plugins.fact.license} MIT`);
    expect(links(html)).toEqual([
      { href: "https://acme.example/notes", name: en.plugins.detailHomepage, apart: true },
    ]);
    expect(html).not.toContain("javascript:");
    // A repository as npm writes it links to its page.
    const repositoryOnly = details({
      ...libraryRow,
      library: { ...LIBRARY, repository: "git+https://github.com/acme/notes.git" },
    });
    expect(links(repositoryOnly)).toEqual([
      { href: "https://github.com/acme/notes", name: en.plugins.detailRepository, apart: true },
    ]);
    // A server module's come from its index entry; a package with none of them links nowhere.
    const moduleFacts = text(details(moduleRow("none", false)));
    expect(moduleFacts).toContain(`${en.plugins.fact.author} Prism Shadow`);
    expect(moduleFacts).toContain(`${en.plugins.fact.license} Apache-2.0`);
    expect(links(details(libraryRow))).toEqual([]);
  });

  it("turns a URL as package.json writes it into the page it names, and anything else into no link", () => {
    expect(webLink("git+https://github.com/acme/notes.git")).toBe("https://github.com/acme/notes");
    expect(webLink("github:acme/notes")).toBe("https://github.com/acme/notes");
    expect(webLink("http://acme.example/notes")).toBe("http://acme.example/notes");
    for (const unsafe of [
      "javascript:alert(1)",
      "git+ssh://git@github.com/acme/notes.git",
      "file:///srv/notes",
      "acme/notes",
      undefined,
    ]) {
      expect(webLink(unsafe), String(unsafe)).toBeNull();
    }
  });
});

describe("a plugin's MCP servers", () => {
  const MAIL: PluginItem = {
    ...LIBRARY,
    name: "mail",
    package: "@acme/mail",
    source: "installed",
    skills: [],
    mcpServers: [
      {
        name: "mail",
        transport: "http",
        target: "https://mail.example.com/mcp",
        setup: [{ key: "MAIL_CLIENT_ID", label: "OAuth client ID" }, { key: "MAIL_CLIENT_SECRET" }],
        oauth: true,
        signIn: true,
      },
      {
        name: "mail-local",
        transport: "stdio",
        target: "node ${PLUGIN_ROOT}/server.mjs",
        setup: [],
        oauth: false,
        signIn: false,
      },
    ],
  };
  const mailRow: PluginRow = {
    key: "library:mail",
    name: "mail",
    category: "other",
    library: MAIL,
  };

  it("lists each in the dialog with its target and marks for the values and the sign-in it needs", () => {
    const html = inLocale(PluginDetailSections, {
      row: mailRow,
      head: HEAD,
      readme: { kind: "none" },
      files: null,
      locale: "en",
    });
    expect(text(html)).toContain(en.plugins.detailMcpServers);
    expect(text(html)).toContain("https://mail.example.com/mcp");
    expect(html).toContain(
      `aria-label="${en.plugins.mcpNeedsSetup(["OAuth client ID", "MAIL_CLIENT_SECRET"])}"`,
    );
    expect(html).toContain(`aria-label="${en.plugins.mcpSignIn}"`);
    expect(html).toContain(
      `aria-label="${en.plugins.mcpRunsCommand("node ${PLUGIN_ROOT}/server.mjs")}"`,
    );
    expect(text(html)).not.toContain(en.plugins.detailFiles);
  });

  it("asks before a stdio server is installed, showing the command it runs here", () => {
    const html = text(
      inLocale(StdioInstallBody, {
        plugin: MAIL,
        lead: en.plugins.installStdioTitle("mail", "General Agent"),
      }),
    );
    expect(html).toContain("Install mail on General Agent?");
    expect(html).toContain(
      en.plugins.installStdioBody("mail-local", "node ${PLUGIN_ROOT}/server.mjs"),
    );
    expect(html).not.toContain("https://mail.example.com/mcp");
  });

  it("names the commands an install of several plugins runs here under each plugin's title, and nothing for plugins without one", () => {
    const html = text(
      inLocale(StdioDisclosure, { plugins: [LIBRARY, { ...MAIL, title: "Mail tools" }] }),
    );
    expect(html).toContain("Mail tools");
    expect(html).toContain(
      en.plugins.installStdioBody("mail-local", "node ${PLUGIN_ROOT}/server.mjs"),
    );
    expect(html).not.toContain("data-analysis");
    expect(inLocale(StdioDisclosure, { plugins: [LIBRARY] })).toBe("");
  });

  it("names the values an Agent's copy waits for, and offers its owner Set up and Uninstall", () => {
    const row = (isOwner: boolean) =>
      inLocale(InstallRow, {
        targetKey: "default_agent",
        radioGroup: "agents",
        selected: true,
        onSelect: () => undefined,
        onDone: () => undefined,
        agentId: "default_agent",
        name: "General Agent",
        installed: true,
        outdated: false,
        mcp: { missingKeys: ["MAIL_CLIENT_SECRET"], signIn: true },
        isOwner,
        onToggle: () => undefined,
        onUpdate: () => undefined,
        onSetUp: () => undefined,
      });
    const owner = row(true);
    expect(buttonText(owner, `${en.plugins.setUp} default_agent`)).toBe(en.plugins.setUp);
    expect(owner).toContain(
      `${en.plugins.mcpNeedsSetup(["MAIL_CLIENT_SECRET"])} · ${en.plugins.mcpSetUpWhere}`,
    );
    expect(buttonText(owner, `${en.skills.uninstall} default_agent`)).toContain(
      en.skills.uninstall,
    );
    const member = row(false);
    expect(buttonText(member, `${en.plugins.setUp} default_agent`)).toBeUndefined();
    // Uninstalling is the owner's alone: a member reads that it is installed and nothing more.
    expect(buttonText(member, `${en.skills.uninstall} default_agent`)).toBeUndefined();
    expect(member).toContain(en.plugins.installModel.addedToAgent);
    expect(member).toContain(
      `${en.plugins.mcpNeedsSetup(["MAIL_CLIENT_SECRET"])} · ${en.plugins.mcpSetUpByOwner}`,
    );
  });

  it("saves Set up as the whole vault: every existing key kept, new values added, empty fields left out", () => {
    expect(
      setUpVaultEntries(["OPENAI_API_KEY", "MAIL_CLIENT_ID"], {
        MAIL_CLIENT_ID: "replaced-id",
        MAIL_CLIENT_SECRET: "new-secret",
        MAIL_TEAM: "",
      }),
    ).toEqual([
      { key: "OPENAI_API_KEY" },
      { key: "MAIL_CLIENT_ID", value: "replaced-id" },
      { key: "MAIL_CLIENT_SECRET", value: "new-secret" },
    ]);
  });
});
