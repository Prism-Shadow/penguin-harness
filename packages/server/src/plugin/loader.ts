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
 * and skipped, leaving its capability unavailable rather than failing the boot. An
 * plugin is a set of modules (core plugin/index.ts): `package.json#penguin.modules`
 * carries the manifests, the default export the code, paired by name.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ModuleDef } from "@prismshadow/penguin-core/kernel";
import { parseManifest } from "@prismshadow/penguin-core/kernel";
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

/**
 * The package's manifests (`package.json#penguin.modules`), found by walking up from the
 * resolved entry file. Each entry is one module's static half; its `name` is what the
 * default export's `modules` is keyed by. Absent = not a plugin package.
 */
async function readPackageManifests(
  file: string | null,
): Promise<{ where: string; manifests: ModuleDef["manifest"][] } | null> {
  if (file === null) return null;
  let dir = path.dirname(file);
  for (;;) {
    const where = path.join(dir, "package.json");
    try {
      const raw = JSON.parse(await fs.readFile(where, "utf8")) as { penguin?: unknown };
      if (raw.penguin === undefined) return null;
      const list = (raw.penguin as { modules?: unknown }).modules;
      if (!Array.isArray(list)) {
        throw new Error(`${where}#penguin: expected { "modules": [ … ] }`);
      }
      return {
        where,
        manifests: list.map((doc, i) => {
          const d = (doc ?? {}) as Record<string, unknown>;
          return parseManifest(
            {
              name: d.name,
              requires: d.requires ?? {},
              provides: d.provides ?? {},
              contributes: d.contributes ?? {},
              ...(d.context !== undefined ? { context: d.context } : {}),
              children: d.children ?? [],
            },
            `${where}#penguin.modules[${i}]`,
          );
        }),
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
  return modules !== null && typeof modules === "object" ? (def as Plugin) : null;
}

/**
 * Loads every configured plugin.
 *
 * The two failure classes are deliberately different. A PER-ENTRY failure (unresolvable
 * specifier, no `activate` export, a throw at import) is collected and skipped: that
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
      const read = await readPackageManifests(file);
      if (read === null) {
        failed.set(specifier, "not a plugin package: no package.json#penguin.modules above it");
        continue;
      }
      const plugin = asPlugin(module);
      if (plugin === null) {
        failed.set(
          specifier,
          "the default export is not a Plugin ({ modules: { <name>: { create } } })",
        );
        continue;
      }
      const byName = new Map<string, ModuleDef>();
      for (const manifest of read.manifests) {
        const impl = plugin.modules[manifest.name];
        if (impl === undefined || typeof impl.create !== "function") {
          throw new Error(
            `${read.where}#penguin names module '${manifest.name}', but the default export's modules has no create() for it`,
          );
        }
        // The manifest is the statically checked half and comes last: code cannot replace it.
        byName.set(manifest.name, { ...impl, manifest });
      }
      for (const name of Object.keys(plugin.modules)) {
        if (!byName.has(name)) {
          throw new Error(
            `the default export has a module '${name}' that ${read.where}#penguin does not declare`,
          );
        }
      }
      // A manifest's `children` names other modules of the same package; the booter wants
      // that hierarchy as nested definitions and checks each node's children against its
      // manifest, so the tree is built here and only its roots join the platform.
      const claimed = new Map<string, string>();
      for (const def of byName.values()) {
        const children: ModuleDef[] = [];
        for (const ref of def.manifest.children) {
          if (typeof ref !== "string") {
            throw new Error(
              `${read.where}#penguin: module '${def.manifest.name}' declares a keyed child, which a plugin cannot supply`,
            );
          }
          const child = byName.get(ref);
          if (child === undefined) {
            throw new Error(
              `${read.where}#penguin: module '${def.manifest.name}' declares child '${ref}', which the package does not define`,
            );
          }
          const parent = claimed.get(ref);
          if (parent !== undefined) {
            throw new Error(
              `${read.where}#penguin: module '${ref}' is a child of both '${parent}' and '${def.manifest.name}'`,
            );
          }
          claimed.set(ref, def.manifest.name);
          children.push(child);
        }
        if (children.length > 0) def.children = children;
      }
      const modules = [...byName.values()].filter((def) => !claimed.has(def.manifest.name));
      loaded.push({ specifier, modules });
    } catch (err) {
      failed.set(specifier, err instanceof Error ? err.message : String(err));
    }
  }
  return { loaded, failed };
}
