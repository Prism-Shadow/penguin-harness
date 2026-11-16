/**
 * The library's categories: the one part of it that is code (an id and two titles each), and the
 * grouping the Plugins page lists by.
 */
import { loadLibraryPlugins } from "./library-reader.js";
import type { LibraryPlugin } from "./library-reader.js";

/** Category manifest entry: id and titles (Chinese optional, displayed per UI language). */
export interface PluginCategory {
  id: string;
  title: string;
  titleZh?: string;
}

/** Grouping result: category metadata + member plugins read from library files. */
export interface ResolvedPluginGroup extends PluginCategory {
  plugins: LibraryPlugin[];
}

/**
 * Category manifest, in display order. Categories group by audience, not by technology: a
 * hook-only plugin sits with the skills it serves the same audience as (goal mode and
 * continual learning are office productivity, and so is company mode). `rsi` (agent
 * self-evolution) comes first and holds exactly the RSI toolkits — the default loop and one
 * plugin per algorithm — so its members are the self-evolution algorithms this build ships. The
 * last one, `sandbox`, is where the server modules that confine every Agent command sit — the
 * sandbox backends, whose index rows name it (`categories: ["sandbox"]`).
 * Docs: /docs/skills § "Built-in library".
 */
export const PLUGIN_CATEGORIES: PluginCategory[] = [
  { id: "rsi", title: "Agent Self-Evolution", titleZh: "Agent 自进化" },
  { id: "office-productivity", title: "Office Productivity", titleZh: "办公效率" },
  { id: "software-development", title: "Software Development", titleZh: "软件开发" },
  { id: "ai-app-development", title: "AI App Development", titleZh: "AI 应用开发" },
  { id: "sandbox", title: "Agent Sandbox", titleZh: "Agent 运行沙箱" },
];

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
