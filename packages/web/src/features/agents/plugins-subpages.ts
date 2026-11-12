/**
 * The Agent settings Plugins tab's sub-pages and the addresses that open them (a pure module,
 * unit tested). Each sub-page is a value of the page's one `?tab=` key: `plugins` opens the
 * tab on its first sub-page, and `skills`, `hooks` and `workbenches` — the tabs it once
 * replaced, still in bookmarks and the docs — open it on their own. Anything else is no
 * sub-page, so the tab shows its first.
 */
import type { IconRef } from "@prismshadow/penguin-server/api";

/** The Plugins tab's sub-pages, each by the `?tab=` value that opens it; the first is the default. */
export const PLUGINS_SUBPAGES = ["plugins", "skills", "hooks", "workbenches"] as const;
export type PluginsSubPage = (typeof PLUGINS_SUBPAGES)[number];

/** `?tab=` values that select the Plugins tab on a sub-page of their own (resolveTabKey's `aliases`). */
export const SUBPAGE_TABS: Readonly<Record<string, "plugins">> = {
  skills: "plugins",
  hooks: "plugins",
  workbenches: "plugins",
};

/** The sub-page a `?tab=` value names; the default for anything else. */
export function resolvePluginsSubPage(raw: string | null): PluginsSubPage {
  const found = PLUGINS_SUBPAGES.find((key) => key === raw);
  return found ?? PLUGINS_SUBPAGES[0];
}

/** The query key naming the plugin whose detail is open on the Plugins sub-page. */
export const PLUGIN_PARAM = "plugin";

/** The plugin a part came from, as a row names it. */
export interface PartSource {
  name: string;
  title: string;
  icon?: IconRef;
}
