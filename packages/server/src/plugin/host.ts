/**
 * The plugin host: the plugins this process loaded, as module definitions the
 * platform boots as children of its tree. Kept out of ./index.ts so the published
 * `@prismshadow/penguin-server/plugin` subpath stays types only.
 */
import type { ModuleDef, Resources } from "@prismshadow/penguin-core/kernel";

/** One loaded plugin: the package, and its modules with manifests paired to code. */
export interface LoadedPlugin {
  specifier: string;
  /**
   * The entry file this was imported from, when there was one to resolve. It is what makes a
   * REUSE safe: the specifier alone does not say which bytes are behind it, and a hot push
   * moves the builtin plugins to a new assets directory — so an entry held from before the
   * push resolves to a different file, and must be imported again rather than kept. Absent on
   * an entry from a generation older than this field (re-imported, which is correct for it)
   * and on a bare specifier the installation itself resolves.
   */
  file?: string | null;
  /** Nodes the plugin adds under the root. */
  modules: ModuleDef[];
  /** Nodes the plugin stands in for, by the replaced node's name. */
  replaces: ModuleDef[];
}

/** One host per server process; load order is the order the modules join the tree. */
export class PluginHost {
  private readonly plugins: LoadedPlugin[] = [];

  /**
   * Registers a plugin; a module name already taken — by an earlier plugin, or twice within
   * this one — is refused here, as this plugin's load failure, rather than surfacing later
   * as a duplicate-module problem that fails the whole App's boot.
   */
  use(plugin: LoadedPlugin): void {
    const taken = new Set(this.modules().map((m) => m.manifest.name));
    for (const m of plugin.modules) {
      if (taken.has(m.manifest.name)) {
        throw new Error(
          `plugin '${plugin.specifier}': module '${m.manifest.name}' is already loaded by another plugin, or declared twice`,
        );
      }
      taken.add(m.manifest.name);
    }
    const replaced = this.replacements();
    for (const m of plugin.replaces) {
      if (replaced.has(m.manifest.name)) {
        throw new Error(
          `plugin '${plugin.specifier}': '${m.manifest.name}' is already replaced by another plugin`,
        );
      }
    }
    this.plugins.push(plugin);
  }

  /** Every plugin module, in load order — what the platform adds to its tree. */
  modules(): readonly ModuleDef[] {
    return this.plugins.flatMap((e) => e.modules);
  }

  /** The nodes plugins stand in for, by name — what the platform builds instead of its own. */
  replacements(): ReadonlyMap<string, ModuleDef> {
    return new Map(this.plugins.flatMap((e) => e.replaces.map((m) => [m.manifest.name, m])));
  }

  /** What is loaded, by specifier — how the next App reuses these objects instead of importing again. */
  entries(): ReadonlyMap<string, LoadedPlugin> {
    return new Map(this.plugins.map((e) => [e.specifier, e]));
  }

  /** Nothing to release at process exit: modules dispose with the App that created them. */
  dispose(): void {}
}

/**
 * Registry key for the loaded plugin host — PARKED PLATFORM STATE, whatever the `runtime:`
 * in the id says (that prefix is a wire contract with older generations, not ownership; see
 * the note over the ids in hmr/capabilities.ts).
 *
 * Nothing about the host is the runtime's business: which plugins a deployment runs is
 * configuration the platform reads, the modules go into the platform's tree, and a platform
 * route writes this very entry when the list changes (http/routes/plugins-installed.ts). It
 * is parked only because the imported objects must survive a swap — a re-import would give
 * the successor different module instances.
 *
 * The platform builds it, at its own boot (plugin/loader.ts's loadPluginHost). The runtime
 * keeps a load of its own only as a shim for platforms older than that move.
 */
export const PLUGINS_RESOURCE_ID = "runtime:plugins";

/**
 * The host the runtime loaded (see ./loader.ts), or an empty one — the honest reading
 * of "this runtime knows nothing about plugins".
 *
 * CLAIMED, not imported: a pushed bundle is compiled standalone, so a module-level host
 * inside it would be a second, empty one and every configured plugin would go missing
 * on the first hot push.
 */
export function pluginHostFrom(resources: Resources): PluginHost {
  const claimed = resources.claim<Partial<PluginHost> | null>(PLUGINS_RESOURCE_ID);
  // A runtime older than this contract publishes a host of another shape (the activate-era
  // one, or one without replacements). A pushed platform must still boot on it, so an
  // unrecognized host reads as "no plugins": what it registered belongs to a generation this
  // platform cannot honor, and the seam says so rather than crashing.
  if (claimed === null || claimed === undefined || typeof claimed.modules !== "function") {
    return new PluginHost();
  }
  if (typeof claimed.replacements !== "function") {
    const host = new PluginHost();
    for (const m of claimed.modules()) {
      host.use({ specifier: m.manifest.name, modules: [m], replaces: [] });
    }
    return host;
  }
  return claimed as PluginHost;
}
