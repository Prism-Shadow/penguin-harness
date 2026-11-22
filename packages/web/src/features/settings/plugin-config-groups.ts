/**
 * Which page of the Settings dialog's Plugins group draws a settings group (an entry of
 * `/api/admin/plugin-config`): every group lands on exactly one.
 *
 * - A group drawn inside another listed group's card stays with that card (an index's sources
 *   inside plugin sources).
 * - A group a plugin declares (`plugin` names its package) is on that plugin's page, on whichever
 *   machine declares it: a plugin that only a machine has gets a page of its own too
 *   (lib/plugin-pages.ts), so plugin sources never draws a plugin's group.
 * - The host's own groups: its sandbox on the Agent sandbox page, the rest (plugin sources) on
 *   the plugin sources page. These are the host's features, named by the host; no plugin is. A
 *   machine on a build older than `plugin` names no group's plugin, so all its groups but the
 *   sandbox's land on plugin sources.
 */
import type { PluginConfigEntry } from "@prismshadow/penguin-server/api";
import { entryPlugin } from "../../lib/plugin-pages";

/** The host's sandbox group: the Agent sandbox page. */
export const SANDBOX_GROUP = "sandbox";

/** A page of the Plugins group, as a settings group lands on it. */
export type GroupPage =
  { kind: "sources" } | { kind: "sandbox" } | { kind: "plugin"; plugin: string };

/**
 * The cards `page` draws from `entries` (one machine's answer): the groups standing on their own
 * there, each with the groups drawn inside it following it in the caller's members.
 */
export function cardsOn(
  page: GroupPage,
  entries: readonly PluginConfigEntry[],
): PluginConfigEntry[] {
  const names = new Set(entries.map((e) => e.name));
  // An entry whose parent is not listed stands on its own rather than disappearing.
  const own = entries.filter((e) => e.parent === undefined || !names.has(e.parent));
  return own.filter((entry) => {
    const plugin = entryPlugin(entry, entries);
    switch (page.kind) {
      case "plugin":
        return plugin === page.plugin;
      case "sandbox":
        return plugin === undefined && entry.name === SANDBOX_GROUP;
      case "sources":
        return plugin === undefined && entry.name !== SANDBOX_GROUP;
    }
  });
}
