/**
 * The one-time listing of preinstalled built-in modules into the Projects a server already has
 * (PRFC-0030). A Project created before a build shipped such a module has no listing of it;
 * creation lists it in every Project made afterwards (PluginModules.preinstall), and this lists
 * it once in the ones that came before, so an upgrade does not take the feature away from them.
 *
 * WHEN. Every boot of a generation, after the database migrations and before the plugin closure
 * is read (hmr/platform.ts). That generation therefore loads the module with no re-assembly of
 * its own, however many Projects there are. Most boots find nothing to do: a package recorded
 * once is never looked at again.
 *
 * WHAT. For each preinstalled module this server has no record of, unless an administrator
 * stopped it (its ledger row says declined): this server's own `[plugins.<machineId>]` table of
 * every Project gains it — nothing else of the file changes, a Project that lists it already is
 * left alone, one whose config will not read is skipped with a log line, and every Project
 * changed is a log line. Then the package is recorded (plugin_module_preinstalls), its ledger
 * row seeded so the administrator sees the module and can stop it. From then on the tables are
 * the administrator's: a removal is never undone by a later boot.
 *
 * SAFE TO REPEAT. The tables are written first and the record last; a listing already in place
 * is skipped. Two generations booting at once (a push crossing a re-assembly) write the same
 * entry, and a process that stops between the two steps does it all again on its next boot,
 * with the same result.
 *
 * BACKWARD COMPATIBILITY. This is the migration of stored config for Projects created before
 * their build preinstalled a module. It stays until the next major version (1.0); whoever
 * prepares 1.0 removes this file, its call in hmr/platform.ts and the plugin_module_preinstalls
 * table (with a migration that drops it), and decides whether a module preinstalled after 1.0
 * should still reach existing Projects (PRFC-0030's open question). See
 * changelog/unreleased/2026-11-19-backward-compatibility.md.
 */
import fs from "node:fs/promises";
import type { DatabaseSync } from "node:sqlite";
import { parse as parseToml } from "smol-toml";
import {
  atomicWriteFile,
  effectivePluginTable,
  migrateProjectConfigTable,
  parsePluginTables,
  pluginTablesToToml,
  projectConfigPath,
  renderProjectConfigToml,
} from "@prismshadow/penguin-core";
import { PluginModulePreinstallsRepo } from "@prismshadow/penguin-library-setting/repos/plugin-module-preinstalls";
import { discoverBuiltinPlugins, listProjectIds, type PluginBase } from "../plugin/loader.js";
import { isPreinstalled, pluginNameOf, withOwnListing } from "../plugin/preinstall.js";
import { migratePenguinGoRoutes } from "./project-config-migrations.js";

export interface PreinstallOnceDeps {
  db: DatabaseSync;
  root: string;
  /** The plugin bases of the generation booting (its own assets, not the committed ones). */
  bases: readonly PluginBase[];
  /** This server's own machine id: the `[plugins.<machineId>]` table that is its own. */
  machineId: string;
  now: () => string;
  log: (line: string) => void;
}

/** Lists each preinstalled module this server has not listed before in every Project it has. Never throws. */
export async function listPreinstalledOnce(deps: PreinstallOnceDeps): Promise<void> {
  try {
    const record = new PluginModulePreinstallsRepo(deps.db);
    const fresh: string[] = [];
    for (const pkg of await discoverBuiltinPlugins(deps.bases)) {
      if (!record.has(pkg) && (await isPreinstalled(pkg, deps.bases))) fresh.push(pkg);
    }
    if (fresh.length === 0) return;
    const listing = fresh.filter((pkg) => !record.declined(pkg));
    if (listing.length > 0) {
      for (const projectId of await listProjectIds(deps.root)) {
        try {
          const added = await listInOwnTable(deps.root, projectId, deps.machineId, listing);
          for (const pkg of added) {
            deps.log(
              `[plugins] module ${pkg}: listed for ${projectId} (preinstalled, once for the Projects this server had)`,
            );
          }
        } catch (err) {
          deps.log(
            `[plugins] ${projectId}: the preinstalled modules were not listed, its config could not be read: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    }
    for (const pkg of fresh) record.record(pkg, pluginNameOf(pkg), deps.now());
  } catch (err) {
    deps.log(
      `[plugins] the preinstalled modules were not listed in the existing Projects, the next boot tries again: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Adds `packages` to this server's own table of one Project, where it does not list them
 * already; answers the ones it added. The file is read and migrated the way the Project config
 * service reads it, so a file from an older release is written back in its current form, and
 * every key but `plugins` survives as it was. No file, nothing to add.
 */
async function listInOwnTable(
  root: string,
  projectId: string,
  machineId: string,
  packages: readonly string[],
): Promise<string[]> {
  const file = projectConfigPath(root, projectId);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const parsed: unknown = parseToml(text);
  const table: Record<string, unknown> =
    parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const tables = parsePluginTables(table.plugins) ?? { all: {}, machines: {} };
  const listed = effectivePluginTable(tables, machineId);
  const added = packages.filter((pkg) => !(pkg in listed));
  if (added.length === 0) return [];
  // The two migrations every read of the service applies (ProjectConfigService.readTable), so
  // that rendering the file cannot hide what they look for — a rendered file always carries a
  // `[providers]` table, which is what tells the key hoist a file is already current.
  migrateProjectConfigTable(table);
  migratePenguinGoRoutes(table);
  table.plugins = pluginTablesToToml(withOwnListing(tables, machineId, added));
  await atomicWriteFile(file, renderProjectConfigToml(table), {
    mode: 0o600,
    followSymlinks: true,
  });
  return added;
}
