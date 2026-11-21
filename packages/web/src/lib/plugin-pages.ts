/**
 * The Settings dialog's plugin pages: one page per plugin that has options for this viewer, in
 * the rail's last group. A page gathers what one plugin brings, wherever it comes from:
 *
 * - its **personal part** — Settings pages its web half contributes in the `plugin` group with
 *   `visibility: "everyone"` (the browser's backend and paired Chromes), which any signed-in
 *   viewer sees;
 * - its **server part**, admins only — the settings groups its server module declares (a
 *   plugin-config entry names its package in `plugin`; one drawn inside another group's card
 *   stays with that card) and its contributed pages with `visibility: "admin"`.
 *
 * A page exists only because the plugin contributes something to it — the host names no plugin.
 * A plugin with nothing this viewer may see has no page. The page's name, icon, version and
 * explanation are the plugin library's (`GET /api/plugins`), by package; a plugin the library
 * does not list (a server module with no Skill: a sandbox backend) is named by its own card's
 * title as the server sends it with its settings group, else that group's title, else its first
 * contributed page's name, else its package, and drawn with that page's glyph or the puzzle
 * piece. Pages sort by name in the interface's language, after the host's own pages.
 *
 * Pure, so the rail and its tests read the same rule: the dialog hands in what it has read and
 * the contributions it was booted with.
 */
import type { PluginConfigEntry, PluginItem } from "@prismshadow/penguin-server/api";
import type { SettingsSectionData } from "@prismshadow/penguin-web-plugin";
import { localizedText } from "./skill-use";
import type { ContributedSettingsKey } from "./settings-sections";

/** What a plugin page needs of a contributed Settings page: its data, and its name. */
export interface PluginSectionRef<C extends { label: () => string }> {
  data: SettingsSectionData;
  code: C;
}

export interface PluginPage<C extends { label: () => string }> {
  /** `plugin:<package>`: the page's key on the rail and in a request. */
  key: ContributedSettingsKey;
  /** The plugin's npm package. */
  package: string;
  /** The page's name, in the interface's language. */
  title: string;
  /** The plugin library's entry for the package, when it lists one (icon, version, description). */
  library?: PluginItem;
  /** The glyph (an `ICONS` key) of the first contributed page: the icon when the library has none. */
  glyph?: string;
  /** The contributed pages of the personal part, in their order. */
  personal: Array<PluginSectionRef<C>>;
  /** The contributed pages of the server part, in their order (admins only). */
  server: Array<PluginSectionRef<C>>;
  /** The names of this server's settings groups the page draws (admins only). */
  groups: string[];
}

export const PLUGIN_PAGE_PREFIX = "plugin:";

export const pluginPageKey = (pkg: string): ContributedSettingsKey =>
  `${PLUGIN_PAGE_PREFIX}${pkg}` as ContributedSettingsKey;

/**
 * The plugin page an entry is drawn on: its package, unless it is drawn inside another listed
 * entry's card (a group a plugin declares with `parent`), which keeps it there.
 */
export function entryPlugin(
  entry: PluginConfigEntry,
  entries: readonly PluginConfigEntry[],
): string | undefined {
  if (entry.plugin === undefined) return undefined;
  if (entry.parent !== undefined && entries.some((e) => e.name === entry.parent)) return undefined;
  return entry.plugin;
}

export interface PluginPagesInput<C extends { label: () => string }> {
  isAdmin: boolean;
  locale: "en" | "zh";
  /** Every contributed Settings page shown now; those outside the `plugin` group are skipped. */
  sections: ReadonlyArray<PluginSectionRef<C>>;
  /** This server's settings groups (an admin's read); empty for anyone else. */
  entries: readonly PluginConfigEntry[];
  /** The plugin library's plugins. */
  library: readonly PluginItem[];
}

export function pluginPages<C extends { label: () => string }>(
  input: PluginPagesInput<C>,
): Array<PluginPage<C>> {
  const { isAdmin, locale } = input;
  const pages = new Map<string, PluginPage<C>>();
  const pageOf = (pkg: string): PluginPage<C> => {
    let page = pages.get(pkg);
    if (page === undefined) {
      page = {
        key: pluginPageKey(pkg),
        package: pkg,
        title: pkg,
        personal: [],
        server: [],
        groups: [],
      };
      pages.set(pkg, page);
    }
    return page;
  };
  const byOrder = (a: PluginSectionRef<C>, b: PluginSectionRef<C>) => a.data.order - b.data.order;
  for (const section of input.sections) {
    const { group, plugin, visibility } = section.data;
    if (group !== "plugin") continue;
    if (plugin === undefined || plugin === "") {
      console.warn(
        `a Settings page keyed "${section.data.key}" is in the plugin group but names no plugin; it is dropped`,
      );
      continue;
    }
    if (visibility === "admin" && !isAdmin) continue;
    const page = pageOf(plugin);
    (visibility === "admin" ? page.server : page.personal).push(section);
    page.glyph ??= section.data.icon;
  }
  if (isAdmin) {
    for (const entry of input.entries) {
      const pkg = entryPlugin(entry, input.entries);
      if (pkg !== undefined) pageOf(pkg).groups.push(entry.name);
    }
  }
  const library = new Map(input.library.map((item) => [item.package, item]));
  for (const page of pages.values()) {
    page.personal.sort(byOrder);
    page.server.sort(byOrder);
    const item = library.get(page.package);
    if (item !== undefined) page.library = item;
    const first = input.entries.find((e) => e.name === page.groups[0]);
    const group = first?.configuration;
    page.title =
      (item?.title !== undefined ? localizedText(locale, item.title, item.titleZh) : undefined) ??
      (first?.pluginTitle !== undefined
        ? localizedText(locale, first.pluginTitle, first.pluginTitleZh)
        : undefined) ??
      (group?.title !== undefined
        ? localizedText(locale, group.title, group.titleZh)
        : undefined) ??
      [...page.personal, ...page.server][0]?.code.label() ??
      page.package;
  }
  const collator = new Intl.Collator(locale === "zh" ? "zh-Hans-CN" : "en");
  return [...pages.values()].sort((a, b) => collator.compare(a.title, b.title));
}

/** Where a request for a Settings page lands among the plugin pages: the page, and a part of it to scroll to. */
export interface PluginPageTarget {
  key: ContributedSettingsKey;
  /** A contributed page's key, or a settings group's name, inside the page. */
  anchor?: string;
}

/**
 * A request that names a plugin page: its key (`plugin:<package>`), a contributed page that joined
 * one (the key it had as a page of its own, so an old link still opens it), or the plugin
 * management page focused on a settings group a plugin page now draws. Null when it names none.
 */
export function pluginPageTarget<C extends { label: () => string }>(
  raw: string | null | undefined,
  pages: ReadonlyArray<PluginPage<C>>,
  focus?: string,
): PluginPageTarget | null {
  if (raw === null || raw === undefined) return null;
  for (const page of pages) {
    if (page.key === raw) return { key: page.key };
    if ([...page.personal, ...page.server].some((s) => s.data.key === raw)) {
      return { key: page.key, anchor: raw };
    }
    if (raw === "plugins" && focus !== undefined && page.groups.includes(focus)) {
      return { key: page.key, anchor: focus };
    }
  }
  return null;
}

/**
 * Whether a request may name a plugin page before the pages are known — a plugin page's key, or a
 * contributed page in the plugin group — so the dialog waits for them rather than falling back to
 * the first page.
 */
export function mayNamePluginPage(
  raw: string | null | undefined,
  sections: ReadonlyArray<{ data: SettingsSectionData }>,
): boolean {
  if (raw === null || raw === undefined) return false;
  return (
    raw.startsWith(PLUGIN_PAGE_PREFIX) ||
    sections.some((s) => s.data.group === "plugin" && s.data.key === raw)
  );
}
