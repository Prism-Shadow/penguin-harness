/**
 * The user plugin directory (`<root>/plugins`): the library's second source beside the
 * `@penguinharness/*` packages the build ships (see plugins/index.ts). One directory per
 * plugin, laid out exactly like a plugin package — `plugin.json`, `icon.svg`, `skills/`,
 * `hooks/` — so the loader needs no second format: these are the writers a remote download and
 * a local upload go through, and the remover the management UI's delete calls.
 *
 * Installing is a staged swap, the same shape as a Skill install: the files land in a
 * dot-prefixed staging directory (never a valid plugin name, so the loader's scan skips it),
 * are read back through the library's own reader — a directory that would not load is rejected
 * before it is committed rather than installed and silently skipped afterwards — and only then
 * replace the real directory in one rename. The staging directory is cleared first, so a
 * leftover from an interrupted install is never merged into this one. The window between
 * removing the old directory and the rename is the one case this cannot make atomic; it is
 * bounded by a single rm and leaves the plugin absent rather than half-written.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PLUGIN_NAME_PATTERN, readPluginDir } from "../plugins/index.js";
import type { LibraryPlugin } from "../plugins/index.js";
import { userPluginsDir } from "./paths.js";

/** Rejects anything that is not a plugin name — the same rule the library's scan applies, restated where a write happens (a name is joined into a path, never trusted). */
function assertPluginName(name: string): void {
  if (!PLUGIN_NAME_PATTERN.test(name)) {
    throw new Error(`Invalid plugin name: ${JSON.stringify(name)}`);
  }
}

/** Rejects a file path that would land outside the plugin directory (a zip's entry path arrives here as given). */
function assertRelativePath(rel: string): void {
  if (
    rel === "" ||
    rel.includes("\\") ||
    rel.startsWith("/") ||
    /^[A-Za-z]:/.test(rel) ||
    rel.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`Invalid plugin file path: ${JSON.stringify(rel)}`);
  }
}

/** Whether a user plugin of this name is installed there (its directory exists). */
export async function userPluginInstalled(root: string, name: string): Promise<boolean> {
  assertPluginName(name);
  try {
    return (await fs.stat(path.join(userPluginsDir(root), name))).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Installs (or replaces) one user plugin from `files` (path relative to the plugin directory →
 * content). Returns the plugin as the library reads it back; throws when the files are not a
 * plugin (no `plugin.json`, an unreadable manifest, a version that is not `YYYY.MM.DD.N`) or a
 * path escapes the directory, and leaves nothing behind in either case.
 *
 * Replacement is unconditional: whether an import may overwrite an existing plugin is the
 * caller's rule (the API answers 409 unless the request asks for it), not the store's.
 */
export async function installUserPlugin(
  root: string,
  name: string,
  files: Record<string, string | Uint8Array>,
): Promise<LibraryPlugin> {
  assertPluginName(name);
  const dir = path.join(userPluginsDir(root), name);
  const staging = path.join(userPluginsDir(root), `.${name}.incoming`);
  await fs.mkdir(userPluginsDir(root), { recursive: true });
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  try {
    for (const [rel, data] of Object.entries(files)) {
      assertRelativePath(rel);
      const file = path.join(staging, rel);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, data);
    }
    const plugin = readPluginDir(name, staging, "user");
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(staging, dir);
    return plugin;
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
}

/** Removes one user plugin's directory; false when there was nothing to remove (an uninstall is idempotent). */
export async function removeUserPlugin(root: string, name: string): Promise<boolean> {
  assertPluginName(name);
  const dir = path.join(userPluginsDir(root), name);
  try {
    if (!(await fs.stat(dir)).isDirectory()) return false;
  } catch {
    return false;
  }
  await fs.rm(dir, { recursive: true, force: true });
  return true;
}
