/**
 * The plugin host: the plugins this process loaded, as module definitions the
 * platform boots as children of its tree. Kept out of ./index.ts so the published
 * `@prismshadow/penguin-server/plugin` subpath stays types only.
 */
import type { ModuleDef, Resources } from "@prismshadow/penguin-core/kernel";

/** One loaded plugin: the package, and its modules with manifests paired to code. */
export interface LoadedPlugin {
  specifier: string;
  modules: ModuleDef[];
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
    this.plugins.push(plugin);
  }

  /** Every plugin module, in load order — what the platform adds to its tree. */
  modules(): readonly ModuleDef[] {
    return this.plugins.flatMap((e) => e.modules);
  }

  /** Nothing to release at process exit: modules dispose with the App that created them. */
  dispose(): void {}
}

/** Registry key the runtime publishes its loaded host under. */
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
  return resources.claim<PluginHost>(PLUGINS_RESOURCE_ID) ?? new PluginHost();
}
