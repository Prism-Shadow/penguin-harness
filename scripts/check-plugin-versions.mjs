#!/usr/bin/env node
/**
 * Every plugin whose files changed since the base commit must carry a new `plugin.json`
 * version. The version is what tells an installed copy it is behind the library (the Agents
 * page's update flag and the plugin library's cards read it), so a content change shipped
 * under the old version is invisible to every user until the next unrelated bump.
 *
 * Usage: node scripts/check-plugin-versions.mjs <base-commit>
 * An empty or missing base (a push event, a local run with nothing to compare) passes.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const base = process.argv[2] ?? "";
if (base.trim() === "") {
  console.log("plugin versions: no base commit given, nothing to compare");
  process.exit(0);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });

/**
 * What an installed copy holds: `installSkill` writes `skills/<name>/SKILL.md` plus its auxiliary
 * files and the plugin's `icon.svg` beside it; `installHook` writes the generated `hooks.json`, the
 * `icon.svg` and the hook scripts; `plugin.json` is the source of the stamped version and of the
 * hook manifest. The filter below counts everything under `plugins/<name>/` except `package.json`
 * and `test/**`, deliberately wider than that set, so a path a plugin adds later over-asks for a
 * bump rather than slipping through unbumped.
 *
 * The two exceptions are the files that never reach an installed copy: `package.json` is workspace
 * and publishing metadata, and release preparation bumps every plugin's in lockstep, so counting it
 * would have failed the first release after this guard landed on all thirteen; `test/` is a test
 * run from the checkout rather than shipped content.
 */
const isInstalledContent = (file) => {
  const parts = file.split("/");
  const metadata = parts.length === 3 && parts[2] === "package.json";
  const test = parts.length >= 3 && parts[2] === "test";
  return !(metadata || test);
};

const changed = git("diff", "--name-only", `${base}...HEAD`, "--", "plugins/")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("plugins/"))
  .filter(isInstalledContent);
const plugins = [...new Set(changed.map((file) => file.split("/")[1]).filter(Boolean))].sort();
if (plugins.length === 0) {
  console.log("plugin versions: no plugin files changed");
  process.exit(0);
}

const versionOf = (json) => {
  try {
    return JSON.parse(json).version ?? null;
  } catch {
    return null;
  }
};
const stale = [];
for (const name of plugins) {
  const manifest = `plugins/${name}/plugin.json`;
  let before;
  try {
    before = versionOf(git("show", `${base}:${manifest}`));
  } catch {
    // A plugin that did not exist at the base commit is new: any version is a new version.
    continue;
  }
  let after;
  try {
    after = versionOf(readFileSync(manifest, "utf8"));
  } catch {
    // Removed plugin: nothing to version.
    continue;
  }
  if (before !== null && before === after) stale.push(`${name} (still ${after})`);
}
if (stale.length > 0) {
  console.error(
    `plugin versions: files changed under plugins/ without a plugin.json version bump — ${stale.join(", ")}. ` +
      "Bump the date version (YYYY.MM.DD.N) so installed copies see the update.",
  );
  process.exit(1);
}
console.log(`plugin versions: ${plugins.join(", ")} changed and carry new versions`);
