/**
 * Preinstalled built-in modules (PRFC-0030): the server modules a build ships for every
 * Project, written into Project config rather than loaded unlisted — availability is still not
 * consent (loader.ts), the tables still say what runs, and an administrator can take one out.
 *
 * WHICH PACKAGES. Built in by PRFC-0031's rule — on this server the package resolves from a
 * prefix the build ships, and its table only adds modules (a same-named package under
 * `<root>/plugins` shadows it, and is not built in) — and its card says `preinstall: true` in so
 * many words. The card's `preinstall` defaults to true for what an install writes into an Agent
 * (default_agent's preinstalled set); a server module needs the explicit `true`, so a shipped
 * backend that says nothing, or says `false` (the sandbox backends), is never listed for every
 * Project. Read from `package.json` and `ifaces.json` alone: nothing is imported.
 *
 * WHERE AND WHEN they are listed is this server's own `[plugins.<machineId>]` table of a
 * Project — never the shared table, never another machine's:
 *   - when a Project is created (services/plugin-modules.ts, `PluginModules.preinstall`);
 *   - once for each Project created before that, at the first boot of a build that ships the
 *     package (services/preinstall-once.ts), unless the card limits provisioning to newly created Projects.
 */
import { libraryContributions, readPluginTable } from "@prismshadow/penguin-core";
import { isBuiltin } from "./builtin.js";
import { discoverBuiltinPlugins, resolvePluginPackage, type PluginBase } from "./loader.js";

export interface PreinstalledModule {
  /** The npm package name, as a plugin table lists it. */
  package: string;
  /** The plugin's name: the package name without its scope. */
  plugin: string;
}

/** Every preinstalled module this server's build ships, by package name. */
export async function preinstalledModules(
  bases: readonly PluginBase[],
  existingProject = false,
): Promise<PreinstalledModule[]> {
  const out: PreinstalledModule[] = [];
  for (const pkg of await discoverBuiltinPlugins(bases)) {
    if (await isPreinstalled(pkg, bases, existingProject))
      out.push({ package: pkg, plugin: pluginNameOf(pkg) });
  }
  return out;
}

/** Whether `pkg` is a preinstalled module on this server (see the header). */
export async function isPreinstalled(
  pkg: string,
  bases: readonly PluginBase[],
  existingProject = false,
): Promise<boolean> {
  if (!(await isBuiltin(pkg, bases))) return false;
  const found = resolvePluginPackage(pkg, bases);
  if (found === null) return false;
  try {
    const table = readPluginTable(found.dir);
    const card = table && libraryContributions(table, []).card;
    return (
      card?.preinstall === true && (!existingProject || card.preinstallExistingProjects !== false)
    );
  } catch {
    // A table that will not read declares nothing; the loader says why when it loads it.
    return false;
  }
}

/** The plugin's name a package carries: its npm name without the scope. */
export function pluginNameOf(pkg: string): string {
  return pkg.slice(pkg.lastIndexOf("/") + 1);
}
