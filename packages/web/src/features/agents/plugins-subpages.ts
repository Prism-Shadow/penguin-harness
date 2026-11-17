/**
 * The Agent settings Plugins tab's sub-pages and the addresses that open them (a pure module,
 * unit tested). Each sub-page is a value of the page's one `?tab=` key: `plugins` opens the
 * tab on its first sub-page, and `skills`, `hooks` and `workbenches` — the tabs it once
 * replaced, still in bookmarks and the docs — open it on their own. Anything else is no
 * sub-page, so the tab shows its first.
 *
 * It also says where a part's own files are: a Skill, a hook package or a workbench is one
 * directory of the Agent State, named as the server's lists name the part, and its browser opens
 * on the file that says what the part is.
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

/** The kinds of part whose files a row opens. */
export type PartKind = "skill" | "hook" | "workbench";

/** A part whose files are open: its kind, its directory's name (a Skill's or hook package's name, a workbench's id) and the dialog's title. */
export interface PartRef {
  kind: PartKind;
  name: string;
  title: string;
}

/** Each kind's folder inside an Agent State. */
const PART_FOLDER: Record<PartKind, string> = {
  skill: "skills",
  hook: "hooks",
  workbench: "workbenches",
};

/** The part's directory inside the Agent State at `stateDir` (absolute, on the Agent's server; "/" joins on every platform Node runs on). */
export function partDir(stateDir: string, part: Pick<PartRef, "kind" | "name">): string {
  return `${stateDir.replace(/[\\/]+$/, "")}/${PART_FOLDER[part.kind]}/${part.name}`;
}

/** The root-level files a part's browser opens on arrival: the first that exists. */
export const PART_LEAD: Record<PartKind, readonly string[]> = {
  skill: ["SKILL.md"],
  hook: ["README.md", "hooks.json"],
  workbench: ["README.md", "package.json"],
};
