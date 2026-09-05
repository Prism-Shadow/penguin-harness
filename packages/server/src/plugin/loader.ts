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
 * and skipped, leaving its capability unavailable rather than failing the boot.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "@prismshadow/penguin-core/plugin";

/** The config file's name inside the data root. */
export const PLUGINS_FILE = "plugins.json";

export interface LoadedPlugin {
  specifier: string;
  plugin: Plugin;
}

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
async function importPlugin(specifier: string): Promise<unknown> {
  const entry = process.argv[1];
  if (typeof entry === "string" && entry.length > 0) {
    try {
      const resolved = createRequire(entry).resolve(specifier);
      return await import(pathToFileURL(resolved).href);
    } catch {
      // Fall through: a dev checkout resolves the specifier directly.
    }
  }
  return await import(specifier);
}

/** A plugin module's contract is one named export: `activate(ctx)`. */
function asPlugin(module: unknown): Plugin | null {
  const activate = (module as { activate?: unknown }).activate;
  return typeof activate === "function" ? { activate: activate as Plugin["activate"] } : null;
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
      const plugin = asPlugin(await importPlugin(specifier));
      if (plugin === null) {
        failed.set(specifier, "module does not export an activate(ctx) function");
        continue;
      }
      loaded.push({ specifier, plugin });
    } catch (err) {
      failed.set(specifier, err instanceof Error ? err.message : String(err));
    }
  }
  return { loaded, failed };
}
