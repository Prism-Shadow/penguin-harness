/**
 * Plugin loading: WHICH plugins a deployment runs is CONFIGURATION, not capability
 * baked into the platform. They do not ride the platform bundle and no hot push
 * delivers one — `<root>/plugins.json` lists them and each entry resolves against the
 * INSTALLATION, so installing or upgrading one is an install-side action.
 *
 * Resolution is anchored at `process.argv[1]`, for the same reason the packaged
 * bundle's own resolver is: a bundle running from `hmr/store` has no node_modules of
 * its own, so anchoring at the bundle would find nothing.
 *
 * Failure is per-entry and non-fatal: an unresolvable or malformed plugin is reported
 * and skipped, leaving its capability unavailable rather than failing the boot. A
 * plugin is a set of modules (core plugin/index.ts): decorated classes, named by the
 * default export, whose manifests the package's generated `ifaces.json` carries.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { IfaceTable, ManifestTable, ModuleDef } from "@prismshadow/penguin-core/kernel";
import { moduleDefOf, parseManifest } from "@prismshadow/penguin-core/kernel";
import type { Plugin } from "@prismshadow/penguin-core/plugin";
import type { LoadedPlugin } from "./host.js";

/** The config file's name inside the data root. */
export const PLUGINS_FILE = "plugins.json";

export type { LoadedPlugin } from "./host.js";

export interface PluginLoadResult {
  loaded: LoadedPlugin[];
  /** specifier → why it was skipped. */
  failed: Map<string, string>;
}
/**
 * An ABSENT file means "no plugins" — the default deployment shape, not an error. Any
 * other outcome is: a file that exists but cannot be read (a permission, a directory in
 * its place, an I/O fault) is indistinguishable from a malformed one for the operator's
 * purposes — something was configured and this process cannot honor it, so running
 * unconfigured would misrepresent what was asked for.
 */
export async function readPluginList(root: string): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(path.join(root, PLUGINS_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `${PLUGINS_FILE} exists but could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${PLUGINS_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const list = (parsed as { plugins?: unknown }).plugins;
  if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string")) {
    throw new Error(`${PLUGINS_FILE} must be { "plugins": ["<package specifier>", …] }`);
  }
  return list as string[];
}

/** Resolved against the installation rather than the bundle's location. */
async function importPlugin(specifier: string): Promise<{ module: unknown; file: string | null }> {
  const entry = process.argv[1];
  if (typeof entry === "string" && entry.length > 0) {
    try {
      const resolved = createRequire(entry).resolve(specifier);
      return { module: await import(pathToFileURL(resolved).href), file: resolved };
    } catch {
      // Fall through: a dev checkout resolves the specifier directly.
    }
  }
  return { module: await import(specifier), file: null };
}

/** The generated table a plugin package ships beside its package.json. */
export const IFACES_FILE = "ifaces.json";

/**
 * The package's generated table (`ifaces.json` beside its `package.json`, the nearest one
 * above the resolved entry file): the manifest of every decorated class, the signature of
 * every interface they name. A package is a plugin by being listed; the table is its
 * MODULE payload, and a package without one ships no modules (`manifests` empty). Null
 * only when no `package.json` is above the file at all.
 */
async function readPackageTable(
  file: string | null,
): Promise<{ where: string; ifaces: IfaceTable; manifests: ManifestTable } | null> {
  if (file === null) return null;
  let dir = path.dirname(file);
  for (;;) {
    const where = path.join(dir, "package.json");
    try {
      await fs.access(where);
      const tableFile = path.join(dir, IFACES_FILE);
      let text: string;
      try {
        text = await fs.readFile(tableFile, "utf8");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        return { where, ifaces: { ifaces: {}, types: {} }, manifests: {} };
      }
      const table = JSON.parse(text) as {
        ifaces?: unknown;
        types?: unknown;
        modules?: unknown;
      };
      const isRecord = (v: unknown) => typeof v === "object" && v !== null && !Array.isArray(v);
      if (!isRecord(table.ifaces) || !isRecord(table.types) || !isRecord(table.modules)) {
        throw new Error(`${tableFile}: expected { ifaces, types, modules } (gen-ifaces output)`);
      }
      const manifests: Record<string, ModuleDef["manifest"]> = {};
      for (const [name, doc] of Object.entries(table.modules as Record<string, unknown>)) {
        manifests[name] = parseManifest(doc, `${tableFile}#modules.${name}`);
      }
      return {
        where,
        ifaces: { ifaces: table.ifaces, types: table.types } as IfaceTable,
        manifests,
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The package's default export as a Plugin, or null when it is not one. */
function asPlugin(module: unknown): Plugin | null {
  const def = (module as { default?: unknown }).default;
  const modules = (def as { modules?: unknown } | null)?.modules;
  return Array.isArray(modules) && modules.every((m) => typeof m === "function")
    ? (def as Plugin)
    : null;
}

/**
 * Loads every configured plugin.
 *
 * The two failure classes are deliberately different. A PER-ENTRY failure (unresolvable
 * specifier, no table, a throw at import) is collected and skipped: that
 * capability is unavailable, which a deployment can recover from. A CONFIG-level failure
 * — the list itself unreadable or malformed — THROWS, because there is no honest way to
 * continue: the operator configured something this process cannot even read, and booting
 * with an empty plugin set would present as a healthy server that silently dropped every
 * capability the config asked for.
 */
export async function loadPlugins(root: string): Promise<PluginLoadResult> {
  const failed = new Map<string, string>();
  const specifiers = await readPluginList(root);
  const loaded: LoadedPlugin[] = [];
  for (const specifier of specifiers) {
    try {
      const { module, file } = await importPlugin(specifier);
      const read = await readPackageTable(file);
      if (read === null) {
        failed.set(specifier, `no package.json above ${file}`);
        continue;
      }
      const plugin = asPlugin(module);
      if (plugin === null) {
        failed.set(
          specifier,
          "the default export is not a Plugin ({ modules: [<@Component or @Module class>, …] })",
        );
        continue;
      }
      if (plugin.modules.length > 0 && Object.keys(read.manifests).length === 0) {
        // Classes named, no table: the package was not built (gen-ifaces runs in its build).
        throw new Error(
          `the default export names module classes, but ${path.join(path.dirname(read.where), IFACES_FILE)} is missing — build the package`,
        );
      }
      const modules: ModuleDef[] = [];
      const seen = new Set<string>();
      for (const cls of plugin.modules) {
        // The class is checked against its generated manifest here (a stale table is a
        // named error); the manifest is checked against the tree at boot.
        const def = moduleDefOf(cls, { manifests: read.manifests });
        if (seen.has(def.manifest.name)) {
          throw new Error(`the default export lists module '${def.manifest.name}' twice`);
        }
        seen.add(def.manifest.name);
        modules.push(def);
      }
      loaded.push({ specifier, modules, ifaces: read.ifaces });
    } catch (err) {
      failed.set(specifier, err instanceof Error ? err.message : String(err));
    }
  }
  return { loaded, failed };
}
