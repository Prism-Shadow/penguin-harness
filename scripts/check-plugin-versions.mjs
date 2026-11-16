#!/usr/bin/env node
/**
 * Every part of a plugin whose installed content changed since the base commit must carry a new
 * dated version. A plugin's own version is its npm version (package.json, bumped by the release);
 * the dated versions — `YYYY.MM.DD.N` — sit on the parts an install writes into an Agent and the
 * Agent may then edit: each Skill's `SKILL.md` frontmatter `version`, the `version` of the hook
 * package the plugin declares in `src/index.ts` (its `PluginLibraryModule.hooks` contribution),
 * and each workbench's `penguin.version` in its own `package.json`. That version is what tells an
 * installed copy it is behind the library (the Agents page's update flag and the Plugins page
 * read it), so a content change shipped under the old version is invisible to every user until
 * the next unrelated bump.
 *
 *   - a change under `plugins/<p>/skills/<s>/` needs that skill's `version` changed;
 *   - a change under `plugins/<p>/workbenches/<w>/` needs its `penguin.version` changed;
 *   - a change to a hook script (under the hooks contribution's `path`), or to a command the
 *     contribution lists (`stop`, `pre_tool_use`, `user_prompt`), needs its `version` changed;
 *   - the rest of `src/index.ts` (the card, the other declarations), `package.json`, `README.md`
 *     and `icon.svg` reach no installed copy and need nothing; neither does a change to a
 *     SKILL.md's `version` line alone.
 *
 * The Benchmarks a new Project is seeded with carry date versions too, kept in core's data; their
 * rule is SEEDED_BENCHMARKS below.
 *
 * Usage: node scripts/check-plugin-versions.mjs <base-commit>
 * An empty or missing base (a push event, a local run with nothing to compare) passes.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import vm from "node:vm";

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
/** The hook points of a hook package; their command lists are what an installed hooks.json runs. */
const HOOK_POINTS = ["stop", "pre_tool_use", "user_prompt"];
/** A hook contribution's commands, absent points as empty lists: what changes an installed hooks.json. */
const hookCommands = (hooks) =>
  canonical(Object.fromEntries(HOOK_POINTS.map((point) => [point, hooks?.[point] ?? []])));

/** Where a plugin declares what it carries: its module's decorator literal (`build` lifts it into ifaces.json). */
const MODULE_SOURCE = "src/index.ts";
const HOOKS_KEY = /["']PluginLibraryModule\.hooks["']\s*:\s*\[/;
/** The index of the bracket closing the one at `open`, past strings and comments; -1 when unclosed. */
function closingBracket(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i += 1; i < text.length && text[i] !== c; i += 1) if (text[i] === "\\") i += 1;
    } else if (c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      if (i === -1) return -1;
    } else if (c === "/" && text[i + 1] === "*") {
      i = text.indexOf("*/", i + 2) + 1;
      if (i === 0) return -1;
    } else if (c === "[" || c === "{") depth += 1;
    else if ((c === "]" || c === "}") && --depth === 0) return i;
  }
  return -1;
}
/**
 * The hook package a module source declares: the first `PluginLibraryModule.hooks` entry, read as
 * the data it is (the generator accepts nothing but literals there) in an empty context. Null
 * when the source declares none; undefined when the declaration will not read.
 */
function hookContribution(source) {
  const key = source === null ? null : HOOKS_KEY.exec(source);
  if (key === null) return null;
  const open = key.index + key[0].length - 1;
  const close = closingBracket(source, open);
  if (close === -1) return undefined;
  try {
    const entries = vm.runInNewContext(`(${source.slice(open, close + 1)})`, {}, { timeout: 1000 });
    const entry = Array.isArray(entries) ? entries[0] : undefined;
    return entry !== null && typeof entry === "object" ? entry : null;
  } catch {
    return undefined;
  }
}

/** The example remains authored here; shipped Benchmark versions live in their packages. */
const SEEDED_BENCHMARKS = [
  {
    sources: ["packages/core/src/state/example-benchmark.ts"],
    versions: "packages/core/src/state/example-benchmark.ts",
  },
];
const dateVersions = (text) =>
  [...text.matchAll(/\bversion:\s*"(\d{4}\.\d{2}\.\d{2}\.\d+)"/g)].map((m) => m[1]).join(",");
/** A line that is a comment (`//`, or part of a `/* … *\/` block) or blank. */
const COMMENT_OR_BLANK = /^\s*(\/\/|\/\*|\*|$)/;
/** Whether `file` changed since the base in a line that is not a comment or blank. */
const changesContent = (file) =>
  git("diff", "-U0", `${base}...HEAD`, "--", file)
    .split("\n")
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line))
    .some((line) => !COMMENT_OR_BLANK.test(line.slice(1)));
const unversioned = [];
for (const { sources, versions } of SEEDED_BENCHMARKS) {
  if (!sources.some(changesContent)) continue;
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
  const moduleFile = `${dir}/${MODULE_SOURCE}`;
  /** The hook package declared at the base and now. */
  const before = hookContribution(atBase(moduleFile));
  const after = hookContribution(atHead(moduleFile));

  for (const workbench of new Set(
    changed
      .filter((file) => file.startsWith(`${dir}/workbenches/`))
      .map((file) => file.split("/")[3]),
  )) {
    const file = `${dir}/workbenches/${workbench}/package.json`;
    const now = json(atHead(file));
    if (now === null) continue;
    const version = now.penguin?.version;
    const previous = json(atBase(file))?.penguin?.version;
    if (typeof version !== "string" || !DATED.test(version))
      problems.push(`${file}: penguin.version must be YYYY.MM.DD.N`);
    else if (version === previous)
      problems.push(`${dir}/workbenches/${workbench} changed but its version is still ${version}`);
    else bumped.push(`${name}/${workbench}`);
  }

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

  // The hook package: its scripts, or the commands its contribution lists.
  if (after === undefined) {
    problems.push(`${moduleFile}: its PluginLibraryModule.hooks entry does not read as a literal`);
    continue;
  }
  if (after === null) continue; // no hook package now: nothing to version
  const scripts = (hooks) => `${dir}/${String(hooks?.path ?? "hooks").replace(/^\.\/|\/+$/g, "")}/`;
  const hooksChanged =
    changed.some((file) => file.startsWith(scripts(after))) ||
    (before && changed.some((file) => file.startsWith(scripts(before)))) ||
    (before && hookCommands(before) !== hookCommands(after));
  if (hooksChanged) {
    const version = after.version;
    if (typeof version !== "string" || !DATED.test(version)) {
      problems.push(
        `${moduleFile}: the hooks contribution's version must be YYYY.MM.DD.N, got ${version}`,
      );
    } else if (typeof before?.version === "string" && before.version === version) {
      problems.push(`${dir}: the hook package changed but its version is still ${version}`);
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
