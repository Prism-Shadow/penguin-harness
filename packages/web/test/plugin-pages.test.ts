/**
 * The Settings dialog's plugin pages (lib/plugin-pages.ts): which plugins get a page for which
 * viewer, what each page holds and is called, and where a request for one lands.
 *
 * - An admin gets a page for every plugin with a settings group or a contributed page; a member
 *   gets one only for a plugin that contributes a page for every viewer, and that page holds
 *   nothing of the server's.
 * - A group drawn inside another listed group's card (a sandbox backend's) stays with that card,
 *   one whose parent is not listed gets its plugin's page, and the host's own groups get none.
 * - A page is named by the plugin library in the interface's language, else by its first group's
 *   title, else by its first contributed page's name, else by its package; pages sort by name.
 * - A contributed page in the plugin group that names no plugin is dropped.
 * - A request for a page's key lands on it; the key a contributed page had of its own lands on its
 *   plugin's page at that part; plugin management focused on a group a plugin page draws lands
 *   there; anything else names no plugin page. Before the pages are known, only a plugin page's
 *   key or a plugin-group page's key may name one.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginConfigEntry, PluginItem } from "@prismshadow/penguin-server/api";
import type { SettingsSectionData } from "@prismshadow/penguin-web-plugin";
import {
  mayNamePluginPage,
  pluginPageKey,
  pluginPageTarget,
  pluginPages,
  type PluginSectionRef,
} from "../src/lib/plugin-pages";

type Code = { label: () => string };
const section = (data: Partial<SettingsSectionData> & { key: string }, name: string) =>
  ({
    data: { group: "plugin", visibility: "everyone", icon: "appWindow", order: 10, ...data },
    code: { label: () => name },
  }) as PluginSectionRef<Code>;

const BROWSER = "@penguinharness/browser-automation";
const COMPUTER = "@penguinharness/computer-use";
const BWRAP = "@penguinharness/sandbox-bwrap";

const SECTIONS = [
  section({ key: "browser", plugin: BROWSER }, "Browser"),
  section({ key: "chromeExtension", plugin: BROWSER, visibility: "admin", order: 20 }, "Chrome"),
  // A page of the app's own rail, not of a plugin's.
  section({ key: "storage", group: "personal" }, "Storage"),
];

const entry = (name: string, extra: Partial<PluginConfigEntry> = {}): PluginConfigEntry => ({
  name,
  configuration: { title: name, properties: {} },
  values: {},
  ...extra,
});

const ENTRIES = [
  entry("sandbox"),
  entry("sandbox-bwrap", { plugin: BWRAP, parent: "sandbox" }),
  entry("computer-use", {
    plugin: COMPUTER,
    configuration: { title: "Computer Use", titleZh: "电脑操作", properties: {} },
  }),
];

const item = (pkg: string, title: string, titleZh: string): PluginItem => ({
  name: pkg.split("/")[1]!,
  package: pkg,
  title,
  titleZh,
  description: "",
  version: "0.2.18",
  source: "builtin",
  skills: [],
  hooks: [],
  mcpServers: [],
});
const LIBRARY = [
  item(BROWSER, "Browser Automation", "浏览器自动化"),
  item(COMPUTER, "Computer Use", "电脑操作"),
];

const pages = (isAdmin: boolean, over: Partial<Parameters<typeof pluginPages>[0]> = {}) =>
  pluginPages<Code>({
    isAdmin,
    locale: "en",
    sections: SECTIONS,
    entries: isAdmin ? ENTRIES : [],
    library: LIBRARY,
    ...over,
  });

afterEach(() => vi.restoreAllMocks());

describe("plugin pages", () => {
  it("gives an admin a page per plugin with options, holding both parts", () => {
    const admin = pages(true);
    expect(admin.map((p) => p.package)).toEqual([BROWSER, COMPUTER]);
    const browser = admin[0]!;
    expect(browser.key).toBe(pluginPageKey(BROWSER));
    expect(browser.personal.map((s) => s.data.key)).toEqual(["browser"]);
    expect(browser.server.map((s) => s.data.key)).toEqual(["chromeExtension"]);
    expect(admin[1]!.groups).toEqual(["computer-use"]);
  });

  it("gives a member only the pages with a part for every viewer, and nothing of the server's", () => {
    const member = pages(false);
    expect(member.map((p) => p.package)).toEqual([BROWSER]);
    expect(member[0]!.server).toEqual([]);
    expect(member[0]!.groups).toEqual([]);
  });

  it("keeps a group drawn inside a listed card with that card, and gives the host's groups no page", () => {
    expect(pages(true).some((p) => p.package === BWRAP)).toBe(false);
    // Its card gone (a machine without the sandbox's group), the backend's group has its page.
    const orphan = pages(true, { entries: [ENTRIES[1]!] });
    expect(orphan.find((p) => p.package === BWRAP)?.groups).toEqual(["sandbox-bwrap"]);
  });

  it("names a page by the library in the interface's language, and sorts by name", () => {
    expect(pages(true, { locale: "zh" }).map((p) => p.title)).toEqual(["电脑操作", "浏览器自动化"]);
    expect(pages(true).map((p) => p.title)).toEqual(["Browser Automation", "Computer Use"]);
  });

  it("falls back to the group's title, the contributed page's name, then the package", () => {
    const bare = pages(true, {
      library: [],
      sections: [...SECTIONS, section({ key: "x", plugin: "@acme/x" }, "Acme X")],
      entries: [...ENTRIES, entry("y", { plugin: "@acme/y", configuration: { properties: {} } })],
    });
    expect(bare.map((p) => [p.package, p.title])).toEqual([
      ["@acme/y", "@acme/y"],
      ["@acme/x", "Acme X"],
      [BROWSER, "Browser"],
      [COMPUTER, "Computer Use"],
    ]);
  });

  it("drops a plugin-group page that names no plugin", () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const lost = pages(false, { sections: [section({ key: "lost" }, "Lost")] });
    expect(lost).toEqual([]);
  });
});

describe("a request for a plugin page", () => {
  const admin = pages(true);

  it("lands on the page its key names", () => {
    expect(pluginPageTarget(pluginPageKey(COMPUTER), admin)).toEqual({
      key: pluginPageKey(COMPUTER),
    });
  });

  it("lands on the plugin's page at the part an old page key names", () => {
    expect(pluginPageTarget("chromeExtension", admin)).toEqual({
      key: pluginPageKey(BROWSER),
      anchor: "chromeExtension",
    });
  });

  it("lands on the plugin's page when plugin management is focused on its group", () => {
    expect(pluginPageTarget("plugins", admin, "computer-use")).toEqual({
      key: pluginPageKey(COMPUTER),
      anchor: "computer-use",
    });
    // The sandbox stays on plugin management.
    expect(pluginPageTarget("plugins", admin, "sandbox")).toBeNull();
    expect(pluginPageTarget("proxy", admin)).toBeNull();
  });

  it("waits for the pages only when the request may name one", () => {
    expect(mayNamePluginPage(pluginPageKey(COMPUTER), SECTIONS)).toBe(true);
    expect(mayNamePluginPage("browser", SECTIONS)).toBe(true);
    expect(mayNamePluginPage("storage", SECTIONS)).toBe(false);
    expect(mayNamePluginPage("proxy", SECTIONS)).toBe(false);
    expect(mayNamePluginPage(undefined, SECTIONS)).toBe(false);
  });
});
