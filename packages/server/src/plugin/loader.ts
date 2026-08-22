/**
 * Plugin loading: WHICH plugins a deployment runs is CONFIGURATION, not capability
 * baked into the platform.
 *
 * Plugins therefore do not ride the platform bundle and are not delivered by a hot
 * push — the list lives in `<root>/plugins.json` and each entry is resolved against
 * the INSTALLATION, so installing or upgrading a backend is an install-side action.
 * That is exactly the property the sandbox needed: its backends (the DSH adaptor,
 * bubblewrap) are packages a deployment chooses, and the harness itself does not
 * depend on any of them.
 *
 * Resolution is anchored at `process.argv[1]` — the entry the host process was started
 * with — for the same reason the packaged bundle's own resolver is (see
 * scripts/deploy.mjs and platform/agent-cli-path.ts): a platform bundle running from
 * `hmr/store` has no node_modules of its own, and anchoring at the bundle's location
 * would find nothing. A plain specifier import is the fallback for dev checkouts.
 *
 * Failure is per-entry and non-fatal: an unresolvable or malformed plugin is reported
 * and skipped, leaving the capabilities it would have provided unavailable (the sandbox
 * service then fails closed for a confining policy) rather than failing the boot.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Plugin } from "./index.js";

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
 * Reads the configured specifiers. A missing file means "no plugins" — the default
 * deployment shape, and not an error. A malformed file IS an error worth surfacing,
 * since silently running unconfigured would misrepresent what the operator asked for.
 */
export async function readPluginList(root: string): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(path.join(root, PLUGINS_FILE), "utf8");
  } catch {
    return [];
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

/** Imports one specifier, resolved against the installation rather than the bundle's location. */
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

/** Loads every configured plugin; per-entry failures are collected, never thrown. */
export async function loadConfiguredPlugins(root: string): Promise<PluginLoadResult> {
  const failed = new Map<string, string>();
  let specifiers: string[];
  try {
    specifiers = await readPluginList(root);
  } catch (err) {
    failed.set(PLUGINS_FILE, err instanceof Error ? err.message : String(err));
    return { loaded: [], failed };
  }
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
