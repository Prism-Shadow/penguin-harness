/**
 * The library's categories: the one part of it that is code (an id and two titles each), and the
 * grouping the Plugins page lists by.
 */
import { loadLibraryPlugins } from "./library-reader.js";
import type { LibraryPlugin } from "./library-reader.js";
import { PLUGIN_CATEGORIES, type PluginCategory } from "./category-manifest.js";

export { PLUGIN_CATEGORIES, type PluginCategory };

/** Grouping result: category metadata + member plugins read from library files. */
export interface ResolvedPluginGroup extends PluginCategory {
  plugins: LibraryPlugin[];
}

/**
 * Groups plugins by category in PLUGIN_CATEGORIES order (members sorted by name; an empty
 * category is omitted); plugins with no or an unknown category land in an Other group appended
 * at the end (only when non-empty). A pure function, the testable core of loadPluginGroups.
 */
export function groupPlugins(all: LibraryPlugin[]): ResolvedPluginGroup[] {
  const groups: ResolvedPluginGroup[] = [];
  const known = new Set(PLUGIN_CATEGORIES.map((c) => c.id));
  for (const category of PLUGIN_CATEGORIES) {
    const members = all
      .filter((p) => p.category === category.id)
      .sort((a, b) => a.name.localeCompare(b.name));
    if (members.length > 0) groups.push({ ...category, plugins: members });
  }
  const others = all
    .filter((p) => p.category === undefined || !known.has(p.category))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (others.length > 0) {
    groups.push({ id: "other", title: "Other", titleZh: "其他", plugins: others });
  }
  return groups;
}

/** Reads the library and groups it (see groupPlugins). */
export function loadPluginGroups(): ResolvedPluginGroup[] {
  return groupPlugins(loadLibraryPlugins());
}
