/**
 * The plugin library as a node of the tree: the owner of the five data-only slots a plugin
 * declares its content to (`PluginLibraryModule.{cards,skills,hooks,mcpServers,workbenches}`, the
 * vocabulary in core plugin/library.ts), and the `PluginLibrary` the plugin routes, the Agent
 * service and Agent seeding read the library through.
 *
 * The library is read STATICALLY, from the packages on disk (core plugin/library-reader.ts):
 * a plugin that carries only content has no code to boot, and the CLI, Agent State and seeding
 * read the same library without a tree. A booted module plugin that also contributes to these
 * slots is on disk too, so the disk read covers it; what the tree hands this module is used only
 * to say, once, when a booted contribution names a plugin the disk read does not list.
 */
import {
  libraryPlugin,
  libraryPluginPackage,
  libraryPluginReadme,
  loadLibraryPlugins,
  loadPluginGroups,
  loadPreinstalledPlugins,
} from "@prismshadow/penguin-core";
import type { LibraryPlugin, ResolvedPluginGroup } from "@prismshadow/penguin-core";
import { Interface, Module, Provide, type ClassCtx } from "@prismshadow/penguin-core/kernel";
import type {
  HookPackageContribution,
  McpServerContribution,
  PluginCard,
  SkillContribution,
  WorkbenchContribution,
} from "@prismshadow/penguin-core/plugin";

/** The plugin library: what can be installed on an Agent, read fresh from disk on every call. */
@Interface()
export abstract class PluginLibrary {
  /** Every plugin in the library, the shipped ones and the operator's, sorted by name. */
  abstract list(): LibraryPlugin[];
  /** The library by category, in display order (empty categories left out). */
  abstract groups(): ResolvedPluginGroup[];
  /** One plugin by name; undefined when the library has none. */
  abstract get(name: string): LibraryPlugin | undefined;
  /** What default_agent gets at creation: every plugin whose card does not opt out. */
  abstract preinstalled(): LibraryPlugin[];
  /** A plugin's README.md: undefined when the library has no such plugin, null when it ships none. */
  abstract readme(name: string): string | null | undefined;
  /** Where a plugin's package is on this machine, with its npm name and version (what an export zips). */
  abstract packageOf(
    name: string,
  ): { dir: string; packageName: string; version: string } | undefined;
}

export interface PluginLibrarySlots {
  /** The package's card: display name, descriptions, category, icon, preinstall, quick start. */
  cards: PluginCard;
  /** One Skill: the directory holding its SKILL.md. */
  skills: SkillContribution;
  /** The package's hook package: its dated version, its scripts' directory, its commands. */
  hooks: HookPackageContribution;
  /** One MCP server: the `tools.mcpServers` entry an install writes. */
  mcpServers: McpServerContribution;
  /** One Workbench app: its source directory. */
  workbenches: WorkbenchContribution;
}

/** The library core reads from disk. */
class DiskPluginLibrary implements PluginLibrary {
  list(): LibraryPlugin[] {
    return loadLibraryPlugins();
  }
  groups(): ResolvedPluginGroup[] {
    return loadPluginGroups();
  }
  get(name: string): LibraryPlugin | undefined {
    return libraryPlugin(name);
  }
  preinstalled(): LibraryPlugin[] {
    return loadPreinstalledPlugins();
  }
  readme(name: string): string | null | undefined {
    return libraryPluginReadme(name);
  }
  packageOf(name: string): { dir: string; packageName: string; version: string } | undefined {
    return libraryPluginPackage(name);
  }
}

/** The slots whose entries are an Agent's content (a card is display, and a server module may carry one). */
const CONTENT_SLOTS = ["skills", "hooks", "mcpServers", "workbenches"] as const;

const said = new Set<string>();

@Module({})
export class PluginLibraryModule {
  @Provide() library!: PluginLibrary;
  setup({ contributions }: ClassCtx) {
    this.library = new DiskPluginLibrary();
    const booted = CONTENT_SLOTS.flatMap((slot) =>
      (contributions[slot] ?? []).map((c) => ({ slot, id: c.id, from: c.from })),
    );
    if (booted.length === 0) return;
    let listed: Set<string>;
    try {
      listed = new Set(this.library.list().map((plugin) => plugin.name));
    } catch {
      // A library that will not read says so where it is read; the boot is not the place.
      return;
    }
    for (const { slot, id, from } of booted) {
      const plugin = id.slice(0, id.indexOf(".") === -1 ? id.length : id.indexOf("."));
      const message = `[plugins] ${from} contributes ${id} to PluginLibraryModule.${slot}, but the library lists no plugin ${plugin}: it reads the packages on disk (the shipped ones and <root>/plugins), and this one is not among them`;
      if (listed.has(plugin) || said.has(message)) continue;
      said.add(message);
      console.warn(message);
    }
  }
}
