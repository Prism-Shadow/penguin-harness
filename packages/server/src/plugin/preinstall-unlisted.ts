/**
 * INTERIM: the preinstalled built-in modules this build ships run for every Project without being
 * listed in any Project's `[plugins]` table, until PRFC-0030's listing (#1642, "preinstalled
 * built-in plugin modules are listed in Project config") is part of this build.
 *
 * Which packages: the rule of #1642's plugin/preinstall.ts. The package is built in — it resolves
 * from a prefix the build ships, and its table adds modules and replaces none — and its card says
 * `preinstall: true` in so many words (an absent `preinstall` means true only for what an install
 * writes into an Agent, never for a server module). Read from `package.json` and `ifaces.json`
 * alone: nothing is imported. Loading is per process, so a module loaded here serves every
 * Project, as one listed in every Project's own table does.
 *
 * SWITCH-OVER: once #1642 is merged into this branch's history, delete this file and its one call
 * in loadPlugins (loader.ts). #1642 lists the same packages in every Project's own table, at
 * creation and once for the Projects that existed at the first boot of a build that ships them,
 * so the closure holds them without this file; and an administrator's Stop, which removes the
 * listing, only takes effect once this file is gone.
 */
import { libraryContributions, readPluginTable } from "@prismshadow/penguin-core";
import {
  discoverBuiltinPlugins,
  readPluginDeclaration,
  resolvePluginPackage,
  type PluginBase,
} from "./loader.js";

/** Whether `pkg` is a preinstalled built-in module on this server (see the header). */
async function preinstalled(pkg: string, bases: readonly PluginBase[]): Promise<boolean> {
  const declared = await readPluginDeclaration(pkg, bases);
  if (
    "error" in declared ||
    !declared.builtin ||
    declared.modules.length === 0 ||
    declared.replaces.length > 0
  ) {
    return false;
  }
  const found = resolvePluginPackage(pkg, bases);
  if (found === null) return false;
  try {
    const table = readPluginTable(found.dir);
    return table !== null && libraryContributions(table, []).card?.preinstall === true;
  } catch {
    // A table that will not read declares nothing; the loader says why if a Project lists it.
    return false;
  }
}

/** The closure, followed by every preinstalled built-in module it does not already name. */
export async function withPreinstalledModules(
  closure: readonly string[],
  bases: readonly PluginBase[],
): Promise<string[]> {
  const out = [...closure];
  for (const pkg of await discoverBuiltinPlugins(bases)) {
    if (!out.includes(pkg) && (await preinstalled(pkg, bases))) out.push(pkg);
  }
  return out;
}
