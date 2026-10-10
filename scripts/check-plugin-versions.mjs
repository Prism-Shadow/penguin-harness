#!/usr/bin/env node
/**
 * Every part of a plugin whose installed content changed since the base commit must carry a new
 * dated version. A plugin's own version is its npm version (package.json, bumped by the release);
 * the dated versions — `YYYY.MM.DD.N` — sit on the parts an install writes into an Agent and the
 * Agent may then edit: each skill's `SKILL.md` frontmatter `version`, and the hook package's
 * `penguin.hooks.version` in `package.json`. That version is what tells an installed copy it is
 * behind the library (the Agents page's update flag and the Plugins page read it), so a content
 * change shipped under the old version is invisible to every user until the next unrelated bump.
 *
 *   - a change under `plugins/<p>/skills/<s>/` needs that skill's `version` changed;
 *   - a change under `plugins/<p>/hooks/`, or to the commands of package.json's
 *     `penguin.hooks`, needs `penguin.hooks.version` changed;
 *   - the rest of `package.json`, `README.md` and `icon.svg` reach no installed copy and need
 *     nothing; neither does a change to a SKILL.md's `version` line alone.
 *
 * Usage: node scripts/check-plugin-versions.mjs <base-commit>
 * An empty or missing base (a push event, a local run with nothing to compare) passes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const base = process.argv[2] ?? "";
if (base.trim() === "") {
  console.log("plugin versions: no base commit given, nothing to compare");
  process.exit(0);
}

// git's stderr is captured, not printed: a file missing at the base is an expected miss, and a
// real failure still throws with git's message in it.
const git = (...args) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
/** A file at the base commit, or null where it did not exist. */
const atBase = (file) => {
  try {
    return git("show", `${base}:${file}`);
  } catch {
    return null;
  }
};
/** A file in the working tree, or null where it does not exist. */
const atHead = (file) => (existsSync(file) ? readFileSync(file, "utf8") : null);
const json = (text) => {
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};
/** JSON with object keys sorted, so reordering a manifest is not read as a change. */
const canonical = (value) =>
  JSON.stringify(value, (_key, v) =>
    v !== null && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );

const DATED = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;
const FRONTMATTER = /^﻿?---\r?\n([\s\S]*?)\r?\n---/;
const VERSION_LINE = /^version\s*:/;
/** The frontmatter `version` of a SKILL.md, or null. */
const skillVersion = (text) => {
  const front = text === null ? null : FRONTMATTER.exec(text);
  const line = front?.[1].split(/\r?\n/).find((l) => VERSION_LINE.test(l));
  return line === undefined ? null : line.slice(line.indexOf(":") + 1).trim();
};
/** A SKILL.md with its frontmatter `version` line taken out: what changes an installed copy. */
const withoutVersion = (text) => {
  const front = FRONTMATTER.exec(text);
  if (front === null) return text;
  const kept = front[1].split(/\r?\n/).filter((l) => !VERSION_LINE.test(l));
  return `---\n${kept.join("\n")}\n---${text.slice(front[0].length)}`;
};
/** A hook declaration's commands without the version: what changes an installed hooks.json. */
const hookCommands = (hooks) => {
  const { version: _version, ...commands } = hooks ?? {};
  return canonical(commands);
};

const changed = git("diff", "--name-only", `${base}...HEAD`, "--", "plugins/")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("plugins/"));
// A plugin is a directory: a file right under plugins/ (the library's README) is nobody's.
const plugins = [
  ...new Set(
    changed
      .map((file) => file.split("/"))
      .filter((parts) => parts.length > 2)
      .map((parts) => parts[1]),
  ),
].sort();
if (plugins.length === 0) {
  console.log("plugin versions: no plugin files changed");
  process.exit(0);
}

const problems = [];
const bumped = [];
for (const name of plugins) {
  const dir = `plugins/${name}`;
  const manifestFile = `${dir}/package.json`;
  const head = json(atHead(manifestFile));
  const baseManifest = json(atBase(manifestFile));
  /** The hook declaration at the base. */
  const before =
    baseManifest?.penguin !== undefined
      ? (baseManifest.penguin.hooks ?? null)
      : // The base may predate the move to package.json; drop once main carries no plugin.json.
        (json(atBase(`${dir}/plugin.json`))?.hooks ?? null);
  const after = head?.penguin?.hooks ?? null;

  // Skills: every skill directory with a changed file.
  const skills = [
    ...new Set(
      changed
        .filter((file) => file.startsWith(`${dir}/skills/`))
        .map((file) => file.split("/")[3])
        .filter(Boolean),
    ),
  ].sort();
  for (const skill of skills) {
    const skillFile = `${dir}/skills/${skill}/SKILL.md`;
    const now = atHead(skillFile);
    if (now === null) continue; // removed: nothing to version
    const version = skillVersion(now);
    if (version === null || !DATED.test(version)) {
      problems.push(`${skillFile}: version must be YYYY.MM.DD.N, got ${version}`);
      continue;
    }
    const then = atBase(skillFile);
    if (then === null) {
      bumped.push(`${name}/${skill}`); // a new skill: any version is new
      continue;
    }
    const files = changed.filter((file) => file.startsWith(`${dir}/skills/${skill}/`));
    const onlyTheVersionLine =
      files.length === 1 && files[0] === skillFile && withoutVersion(now) === withoutVersion(then);
    if (onlyTheVersionLine) continue;
    const previous = skillVersion(then);
    if (previous !== null && previous === version) {
      problems.push(`${dir}/skills/${skill} changed but its version is still ${version}`);
    } else {
      bumped.push(`${name}/${skill}`);
    }
  }

  // The hook package: its scripts, or the commands package.json declares for it.
  const hooksChanged =
    changed.some((file) => file.startsWith(`${dir}/hooks/`)) ||
    (before !== null && head !== null && hookCommands(before) !== hookCommands(after));
  if (hooksChanged && head !== null && existsSync(`${dir}/hooks`)) {
    const version = after?.version;
    if (typeof version !== "string" || !DATED.test(version)) {
      problems.push(`${manifestFile}: penguin.hooks.version must be YYYY.MM.DD.N, got ${version}`);
    } else if (typeof before?.version === "string" && before.version === version) {
      problems.push(`${dir}/hooks changed but penguin.hooks.version is still ${version}`);
    } else {
      bumped.push(`${name} hooks`);
    }
  }
}

if (problems.length > 0) {
  console.error(
    `plugin versions:\n${problems.map((p) => `  - ${p}`).join("\n")}\n` +
      "Raise the changed part's date version (YYYY.MM.DD.N: today's date, then the next sequence number) so installed copies see the update.",
  );
  process.exit(1);
}
console.log(
  bumped.length > 0
    ? `plugin versions: ${bumped.join(", ")} changed and carry new versions`
    : `plugin versions: ${plugins.join(", ")} changed, but nothing an install writes`,
);
