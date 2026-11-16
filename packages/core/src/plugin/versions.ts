/**
 * Dated versions, `YYYY.MM.DD.N`: what an Agent may edit locally once installed carries one — each
 * Skill in its SKILL.md frontmatter, a hook package in its `hooks` contribution (written into
 * hooks.json), a Workbench app in its own package.json. An installed copy is behind the library
 * when its part's version is older. A plugin's own version is its npm version, which is not one of
 * these.
 */
import { PLUGIN_VERSION_PATTERN } from "./package-json.js";
import type { HookCommand, UserPromptTrigger } from "./library.js";
import type { LibraryPlugin } from "./library-reader.js";

/** The spelling used before this format, `2026-08-29.1`: still read wherever an installed copy carries it (see parsePluginVersion). */
const LEGACY_PLUGIN_VERSION_PATTERN = /^\d{4}-\d{2}-\d{2}\.\d+$/;

/**
 * Reads either spelling of a version — the current `YYYY.MM.DD.N` and the legacy
 * `YYYY-MM-DD.N` — into the date and sequence number both denote, or null when the string is
 * not a version at all. The two spellings of one version parse to the same key, so a copy
 * installed before the rename compares equal to the library's copy of that same version:
 * installed copies predate the rename, and reinstalling every one of them over a spelling
 * would put noise in the update badges instead of information.
 */
export function parsePluginVersion(version: string): { date: string; seq: number } | null {
  if (!PLUGIN_VERSION_PATTERN.test(version) && !LEGACY_PLUGIN_VERSION_PATTERN.test(version)) {
    return null;
  }
  const dot = version.lastIndexOf(".");
  return { date: version.slice(0, dot).replace(/-/g, "."), seq: Number(version.slice(dot + 1)) };
}

/**
 * Orders two versions: by date, then by sequence number (numeric, so `.10` follows `.9`). Both
 * spellings are read (see parsePluginVersion), so the legacy and current spellings of one
 * version compare equal. A string that is not a version (the empty string an unversioned
 * install reads as, a legacy natural number) sorts before every real version, so anything in
 * the library counts as newer.
 */
export function comparePluginVersions(a: string, b: string): number {
  const va = parsePluginVersion(a);
  const vb = parsePluginVersion(b);
  if (!va || !vb) return Number(va !== null) - Number(vb !== null);
  if (va.date !== vb.date) return va.date < vb.date ? -1 : 1;
  return va.seq - vb.seq;
}

/**
 * The newest dated version among a library plugin's parts — its skills and its hook package:
 * the date of the last change to what an install writes. Only a label (the update badge's
 * "which update" and the update dialog's "new"); whether an installed copy is behind is decided
 * part by part. "" for a plugin with no parts.
 */
export function pluginContentVersion(
  plugin: Pick<LibraryPlugin, "skills" | "hooks" | "workbenches">,
): string {
  let newest = "";
  for (const version of [
    ...plugin.skills.map((s) => s.version),
    ...(plugin.workbenches ?? []).map((w) => w.version),
    ...(plugin.hooks !== undefined ? [plugin.hooks.manifest.version] : []),
  ]) {
    if (comparePluginVersions(version, newest) > 0) newest = version;
  }
  return newest;
}

/**
 * The first manifest version written for a harness that runs `user_prompt` commands on every
 * Prompt. See {@link userPromptTrigger}.
 */
export const USER_PROMPT_EVERY_PROMPT_SINCE = "2026.09.29.1";

/**
 * When one `user_prompt` command of a manifest runs. A command that says so decides; one
 * that does not runs on every Prompt.
 *
 * COMPAT (remove at 0.3.0 release preparation; the release notes must first require
 * updating the goal plugin): the point used to be reached by name only, and the goal
 * package installed before this version starts an unbudgeted goal whenever its `start.mjs`
 * runs without a budget. A manifest carrying a real plugin version older than
 * {@link USER_PROMPT_EVERY_PROMPT_SINCE} therefore keeps the by-name reading for the
 * commands that name no trigger. A manifest with no version, or one that is not a plugin
 * version (a hand-written package), is not affected.
 */
export function userPromptTrigger(
  manifestVersion: string,
  command: HookCommand,
): UserPromptTrigger {
  if (command.trigger !== undefined) return command.trigger;
  return predatesEveryPromptHooks(manifestVersion) ? "host" : "prompt";
}

/** Whether a manifest version is a real plugin version from before `user_prompt` commands ran on every Prompt (the compatibility rule of {@link userPromptTrigger}). */
export function predatesEveryPromptHooks(manifestVersion: string): boolean {
  return (
    parsePluginVersion(manifestVersion) !== null &&
    comparePluginVersions(manifestVersion, USER_PROMPT_EVERY_PROMPT_SINCE) < 0
  );
}
