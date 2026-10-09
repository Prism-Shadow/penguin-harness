#!/usr/bin/env node
/**
 * Every plugin whose files changed since the base commit must carry a new `plugin.json`
 * version. The version is what tells an installed copy it is behind the library (the Agents
 * page's update flag and the plugin library's cards read it), so a content change shipped
 * under the old version is invisible to every user until the next unrelated bump. The
 * Benchmarks a new Project is seeded with carry date versions too, kept in core's data; their
 * rule is SEEDED_BENCHMARKS below.
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
 * The Benchmarks a new Project is seeded with carry date versions too: the example's in
 * example-benchmark.ts, each built-in's in builtin-benchmarks-data.ts, whose rows
 * builtin-benchmarks.ts writes into statements. The built-ins are also published as packages in
 * the benchmark repository, where a version names one exact content. So a change to any of these
 * files must change at least one of the `version: "YYYY.MM.DD.N"` literals in the file that holds
 * the versions; a file that did not exist at the base commit is new and passes.
 */
const SEEDED_BENCHMARKS = [
  {
    sources: ["packages/core/src/state/example-benchmark.ts"],
    versions: "packages/core/src/state/example-benchmark.ts",
  },
  {
    sources: [
      "packages/core/src/state/builtin-benchmarks-data.ts",
      "packages/core/src/state/builtin-benchmarks.ts",
    ],
    versions: "packages/core/src/state/builtin-benchmarks-data.ts",
  },
];
const dateVersions = (text) =>
  [...text.matchAll(/\bversion:\s*"(\d{4}\.\d{2}\.\d{2}\.\d+)"/g)].map((m) => m[1]).join(",");
const unversioned = [];
for (const { sources, versions } of SEEDED_BENCHMARKS) {
  if (git("diff", "--name-only", `${base}...HEAD`, "--", ...sources).trim() === "") continue;
  let before;
  try {
    before = dateVersions(git("show", `${base}:${versions}`));
  } catch {
    continue;
  }
  let after;
  try {
    after = dateVersions(readFileSync(versions, "utf8"));
  } catch {
    continue;
  }
  if (before === after) unversioned.push(versions);
}
if (unversioned.length > 0) {
  console.error(
    `benchmark versions: the seeded Benchmarks changed without a new version in ${unversioned.join(", ")}. ` +
      "Move the version (YYYY.MM.DD.N) of every Benchmark whose files the change alters.",
  );
  process.exit(1);
}

/**
 * What an installed copy actually holds: `installPlugin` writes the plugin's skills and its hook
 * package into the Agent's state directory, and nothing else. A plugin's npm `package.json` is
 * workspace and publishing metadata that never reaches an installed copy, so a change confined to
 * it cannot be invisible to a user — and demanding a `plugin.json` bump for it would advertise an
 * update whose content is identical. Release preparation bumps every plugin's `package.json` in
 * lockstep, so without this the first release after this guard landed failed on all thirteen.
 */
const isInstalledContent = (file) => {
  const parts = file.split("/");
  return !(parts.length === 3 && parts[2] === "package.json");
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
