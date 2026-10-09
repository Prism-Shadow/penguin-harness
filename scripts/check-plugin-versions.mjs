#!/usr/bin/env node
/**
 * Every part of a plugin whose installed content changed since the base commit must carry a new
 * dated version. A plugin's own version is its npm version (package.json, bumped by the release);
 * the dated versions — `YYYY.MM.DD.N` — sit on the parts an install writes into an Agent and the
 * Agent may then edit: each skill's `SKILL.md` frontmatter `version`, and the hook package's
 * `hooks.version` in `plugin.json`. That version is what tells an installed copy it is behind the
 * library (the Agents page's update flag and the Plugins page read it), so a content change
 * shipped under the old version is invisible to every user until the next unrelated bump.
 *
 *   - a change under `plugins/<p>/skills/<s>/` needs that skill's `version` changed;
 *   - a change under `plugins/<p>/hooks/`, or to the commands of `plugin.json`'s `hooks`, needs
 *     `hooks.version` changed;
 *   - `package.json`, `README.md`, `icon.svg` and the rest of `plugin.json` reach no installed
 *     copy and need nothing; neither does a change to a SKILL.md's `version` line alone.
 *
 * Two more rules hold the move from one dated version per plugin to one per part. `plugin.json`
 * carries no top-level `version` (the loader ignores one, so a bump there would reach nobody).
 * And where the base still had one, every part starts at or after it: installed copies carry
 * that version on every part, so a part initialised below it would read as older than what
 * Agents have, and its next bump could stay below it and never be offered.
 *
 * Usage: node scripts/check-plugin-versions.mjs <base-commit>
 * An empty or missing base (a push event, a local run with nothing to compare) passes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const base = process.argv[2] ?? "";
if (base.trim() === "") {
  console.log("plugin versions: no base commit given, nothing to compare");
  process.exit(0);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" });
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
/** plugin.json's hook commands without the version: what changes an installed hooks.json. */
const hookCommands = (manifest) => {
  const { version: _version, ...commands } = manifest?.hooks ?? {};
  return canonical(commands);
};
/** Whether dated version `a` is older than `b`: by date, then by sequence number, numerically. */
const older = (a, b) => {
  const split = (v) => [v.slice(0, v.lastIndexOf(".")), Number(v.slice(v.lastIndexOf(".") + 1))];
  const [da, sa] = split(a);
  const [db, sb] = split(b);
  return da === db ? sa < sb : da < db;
};

const changed = git("diff", "--name-only", `${base}...HEAD`, "--", "plugins/")
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.startsWith("plugins/"));
const plugins = [...new Set(changed.map((file) => file.split("/")[1]).filter(Boolean))].sort();
if (plugins.length === 0) {
  console.log("plugin versions: no plugin files changed");
  process.exit(0);
}

const problems = [];
const bumped = [];
for (const name of plugins) {
  const dir = `plugins/${name}`;
  const manifestFile = `${dir}/plugin.json`;
  const head = json(atHead(manifestFile));
  const before = json(atBase(manifestFile));
  if (head !== null && head.version !== undefined) {
    problems.push(
      `${manifestFile} carries a top-level version, which nothing reads: a plugin's version is its npm version — raise the version of the skill or the hook package that changed instead`,
    );
  }
  /** The one dated version every part of an install carried, where the base still had it. */
  const formerVersion =
    typeof before?.version === "string" && DATED.test(before.version) ? before.version : null;

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
    if (then === null) continue; // a new skill: any version is new
    const files = changed.filter((file) => file.startsWith(`${dir}/skills/${skill}/`));
    const onlyTheVersionLine =
      files.length === 1 && files[0] === skillFile && withoutVersion(now) === withoutVersion(then);
    if (onlyTheVersionLine) continue;
    const previous = skillVersion(then) ?? formerVersion;
    if (previous !== null && previous === version) {
      problems.push(`${dir}/skills/${skill} changed but its version is still ${version}`);
    } else {
      bumped.push(`${name}/${skill}`);
    }
  }

  // The hook package: its scripts, or the commands plugin.json lists for it.
  const hooksChanged =
    changed.some((file) => file.startsWith(`${dir}/hooks/`)) ||
    (before !== null && head !== null && hookCommands(before) !== hookCommands(head));
  if (hooksChanged && head !== null && existsSync(`${dir}/hooks`)) {
    const version = head.hooks?.version;
    if (typeof version !== "string" || !DATED.test(version)) {
      problems.push(`${manifestFile}: hooks.version must be YYYY.MM.DD.N, got ${version}`);
    } else {
      const previous =
        typeof before?.hooks?.version === "string" ? before.hooks.version : formerVersion;
      if (previous !== null && previous === version) {
        problems.push(`${dir}/hooks changed but hooks.version is still ${version}`);
      } else {
        bumped.push(`${name} hooks`);
      }
    }
  }

  // Every part starts at or after the version the base carried for the whole plugin.
  if (formerVersion !== null && head !== null) {
    const parts = [];
    if (existsSync(`${dir}/skills`)) {
      for (const entry of readdirSync(`${dir}/skills`, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const skillFile = `${dir}/skills/${entry.name}/SKILL.md`;
        parts.push([skillFile, skillVersion(atHead(skillFile))]);
      }
    }
    if (existsSync(`${dir}/hooks`)) parts.push([`${manifestFile} hooks`, head.hooks?.version]);
    for (const [where, version] of parts) {
      if (typeof version === "string" && DATED.test(version) && older(version, formerVersion)) {
        problems.push(
          `${where}: version ${version} is older than ${formerVersion}, which every installed copy of ${name} carries`,
        );
      }
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
