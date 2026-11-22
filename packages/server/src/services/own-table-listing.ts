/**
 * Lists packages in this server's own `[plugins.<machineId>]` table of one Project by editing its
 * config file directly, for the steps that run at boot before the tree exists (the one-time
 * listing of preinstalled modules, and the re-listing of the modules behind system apps).
 */
import fs from "node:fs/promises";
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
import { withOwnListing } from "./plugin-tables.js";
import { migratePenguinGoRoutes } from "./project-config-migrations.js";

/** A Project config that is not TOML, unlike a file that cannot be read or written. */
export class UnparseableConfig extends Error {}

/**
 * Adds `packages` to this server's own table of one Project, where it does not list them
 * already; answers the ones it added. The file is read and migrated the way the Project config
 * service reads it, so a file from an older release is written back in its current form, and
 * every key but `plugins` survives as it was. No file, nothing to add. Throws UnparseableConfig
 * for a file that is not TOML, and the I/O error itself for one that cannot be read or written.
 */
export async function listInOwnTable(
  root: string,
  projectId: string,
  machineId: string,
  packages: readonly string[],
): Promise<string[]> {
  if (packages.length === 0) return [];
  const file = projectConfigPath(root, projectId);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = parseToml(text);
  } catch (err) {
    throw new UnparseableConfig(err instanceof Error ? err.message : String(err));
  }
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
