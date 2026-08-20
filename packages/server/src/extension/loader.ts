/**
 * Extension loading: WHICH extensions a deployment runs is CONFIGURATION, not capability
 * baked into the platform. They do not ride the platform bundle and no hot push
 * delivers one — `<root>/extensions.json` lists them and each entry resolves against the
 * INSTALLATION, so installing or upgrading one is an install-side action.
 *
 * Resolution is anchored at `process.argv[1]`, for the same reason the packaged
 * bundle's own resolver is: a bundle running from `hmr/store` has no node_modules of
 * its own, so anchoring at the bundle would find nothing.
 *
 * Failure is per-entry and non-fatal: an unresolvable or malformed extension is reported
 * and skipped, leaving its capability unavailable rather than failing the boot.
 */
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { Extension } from "./index.js";

/** The config file's name inside the data root. */
export const EXTENSIONS_FILE = "extensions.json";

export interface LoadedExtension {
  specifier: string;
  extension: Extension;
}

export interface ExtensionLoadResult {
  loaded: LoadedExtension[];
  /** specifier → why it was skipped. */
  failed: Map<string, string>;
}

/**
 * An ABSENT file means "no extensions" — the default deployment shape, not an error. Any
 * other outcome is: a file that exists but cannot be read (a permission, a directory in
 * its place, an I/O fault) is indistinguishable from a malformed one for the operator's
 * purposes — something was configured and this process cannot honor it, so running
 * unconfigured would misrepresent what was asked for.
 */
export async function readExtensionList(root: string): Promise<string[]> {
  let text: string;
  try {
    text = await fs.readFile(path.join(root, EXTENSIONS_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(
      `${EXTENSIONS_FILE} exists but could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(
      `${EXTENSIONS_FILE} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const list = (parsed as { extensions?: unknown }).extensions;
  if (!Array.isArray(list) || list.some((entry) => typeof entry !== "string")) {
    throw new Error(`${EXTENSIONS_FILE} must be { "extensions": ["<package specifier>", …] }`);
  }
  return list as string[];
}

/** Resolved against the installation rather than the bundle's location. */
async function importExtension(specifier: string): Promise<unknown> {
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

/** An extension module's contract is one named export: `activate(ctx)`. */
function asExtension(module: unknown): Extension | null {
  const activate = (module as { activate?: unknown }).activate;
  return typeof activate === "function" ? { activate: activate as Extension["activate"] } : null;
}

/**
 * Loads every configured extension.
 *
 * The two failure classes are deliberately different. A PER-ENTRY failure (unresolvable
 * specifier, no `activate` export, a throw at import) is collected and skipped: that
 * capability is unavailable, which a deployment can recover from. A CONFIG-level failure
 * — the list itself unreadable or malformed — THROWS, because there is no honest way to
 * continue: the operator configured something this process cannot even read, and booting
 * with an empty extension set would present as a healthy server that silently dropped every
 * capability the config asked for.
 */
export async function loadExtensions(root: string): Promise<ExtensionLoadResult> {
  const failed = new Map<string, string>();
  const specifiers = await readExtensionList(root);
  const loaded: LoadedExtension[] = [];
  for (const specifier of specifiers) {
    try {
      const extension = asExtension(await importExtension(specifier));
      if (extension === null) {
        failed.set(specifier, "module does not export an activate(ctx) function");
        continue;
      }
      loaded.push({ specifier, extension });
    } catch (err) {
      failed.set(specifier, err instanceof Error ? err.message : String(err));
    }
  }
  return { loaded, failed };
}
