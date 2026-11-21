/**
 * Which page of the Settings dialog's Plugins group draws a settings group (an entry of
 * `/api/admin/plugin-config`): every group lands on exactly one.
 *
 * - A group drawn inside another listed group's card stays with that card (an index's sources
 *   inside plugin sources).
 * - A group a plugin declares (`plugin` names its package) is on that plugin's page. On another
 *   machine, a plugin with no page of its own here (`claimed` lists the ones that have one) keeps
 *   its groups on the plugin sources page, so none is out of reach.
 * - The host's own groups: its sandbox on the Agent sandbox page, the rest (plugin sources) on
 *   the plugin sources page. These are the host's features, named by the host; no plugin is.
 */
import type { PluginConfigEntry } from "@prismshadow/penguin-server/api";
import { entryPlugin } from "../../lib/plugin-pages";

/** The host's sandbox group: the Agent sandbox page. */
export const SANDBOX_GROUP = "sandbox";

/** A page of the Plugins group, as a settings group lands on it. */
export type GroupPage =
  | { kind: "sources"; claimed: ReadonlySet<string> }
  | { kind: "sandbox" }
  | { kind: "plugin"; plugin: string };

/**
 * The cards `page` draws from `entries` (one machine's answer): the groups standing on their own
 * there, each with the groups drawn inside it following it in the caller's members.
 */
export function cardsOn(
  page: GroupPage,
  entries: readonly PluginConfigEntry[],
  remote: boolean,
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
        if (plugin === undefined) return entry.name !== SANDBOX_GROUP;
        return remote && !page.claimed.has(plugin);
    }
  });
}
