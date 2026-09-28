#!/usr/bin/env node
/**
 * The shipped skill content of the plugin tree: every `plugins/<plugin>/skills/<name>/` is
 * installed into an Agent's `agent_state/skills/<name>/` and read by a model, and almost nothing
 * here opened one of those files — `check-plugin-versions.mjs` reads `plugin.json`,
 * `check-publishable.mjs` reads `package.json`, no test under `plugins/` reads a `SKILL.md`, and
 * the one suite that does read them, `packages/core/test/plugins.test.ts`, does it through the
 * loader and for the loader's metadata only: it never looks at a relative link inside the
 * content, at a name two plugins both ship, or at a description the loader reads as empty.
 * Content no check reads rots silently.
 *
 * Five rules, each one a failure the loader — or the CLI a skill drives — makes silent rather than loud:
 *
 * 1. frontmatter — `skills/<name>/SKILL.md` exists and its first `---` block parses the way the
 *    loader parses it (`parseSkillFrontmatter` in `packages/core/src/plugins/index.ts`): a `name`
 *    and a non-empty single-line `description`. The loader takes the installed name from the
 *    *directory* (`readSkillDir`), so a frontmatter `name` that differs is a silent mismatch,
 *    and a wrapped `description` silently loses everything after its first line.
 * 2. unique-name — the whole library installs into one flat `agent_state/skills/<name>/`
 *    (`pluginFiles` in `packages/server/src/services/plugin-library.ts`), so two plugins
 *    shipping one name means one of them silently overwrites the other.
 * 3. links — every relative link in a shipped file resolves to a file the same skill ships (only
 *    that skill's own files install, so a link leaving the skill directory is broken once
 *    installed), and every shipped reference file is reachable from its own `SKILL.md`.
 * 4. manifest — every `plugin.json` parses and carries a `YYYY.MM.DD.N` `version`, the
 *    `PLUGIN_VERSION_PATTERN` the loader refuses to load without. The loader throws on it too,
 *    but only once something loads the library and only after a build; this reads the file.
 * 5. commands — every `penguin …` invocation a `SKILL.md` names inside a fenced block or an
 *    inline code span resolves to a command the CLI of *this checkout* registers
 *    (`packages/cli/src/commands/*.ts`, read statically by `scripts/lib/plugin-skill-commands.mjs`,
 *    which the company plugin's own suite reads its registration from too). A skill is an
 *    instruction to run those commands; one the CLI does not register fails only when someone
 *    follows it. The registration is always this checkout's, never the pointed-at root's, so a
 *    copy of `plugins/` is measured against the CLI beside the guard; a registration the reader
 *    cannot trace is a violation, not an empty surface. Not measured: an invocation in prose,
 *    a flag the command does not declare (`penguin org channel --nope` resolves to `org
 *    channel`), a command that exists only at another revision, and a skill naming no `penguin`
 *    command at all — the coverage line lists those skills so they stay visible.
 *
 * Usage: node scripts/check-plugin-skills.mjs [root]
 * `root` holds `plugins/` — a copy, when the guard is pointed at a fixture; this checkout
 * otherwise. Exits non-zero and names every offending file and the rule it broke.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractInvocations,
  measureSkills,
  readCliCommands,
  resolveInvocation,
} from "./lib/plugin-skill-commands.mjs";

/** This checkout; `argv[2]` overrides it so the guard can be run against a copy. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = path.resolve(process.argv[2] ?? REPO_ROOT);
const PLUGINS = path.join(ROOT, "plugins");
/** Rule 5's surface: the CLI beside this guard, whatever `root` points at. */
const CLI_COMMANDS = path.join(REPO_ROOT, "packages/cli/src/commands");

/** `PLUGIN_VERSION_PATTERN` of `packages/core/src/plugins/index.ts`. */
const VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

/** `readDirFiles(dir, ["SKILL.md", "icon.svg"])`: neither of the two installs as content. */
const NOT_CONTENT = new Set(["SKILL.md", "icon.svg"]);

/** The rule ids a violation line carries; the coverage line names them all. */
const RULES = ["frontmatter", "unique-name", "links", "manifest", "commands"];

const violations = [];
const report = (rule, file, message) => violations.push({ rule, file, message });

/** A path as the repository names it, whatever the platform's separator is. */
const posix = (abs) => path.relative(ROOT, abs).split(path.sep).join("/");

/** Every regular file under `dir`, as a sorted POSIX path relative to `dir`. */
function filesUnder(dir) {
  const out = [];
  const walk = (abs, rel) => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  };
  walk(dir, "");
  return out.sort();
}

/**
 * Mirrors `parseSkillFrontmatter`: the first `---` block, one `key: value` per line, scalars
 * only, split on the first colon. Returns null when there is no such block at all.
 */
function frontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content.replace(/^\ufeff/, ""));
  if (!match) return null;
  const lines = match[1].split(/\r?\n/);
  const fields = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key) fields[key] = line.slice(idx + 1).trim();
  }
  return { fields, lines };
}

/**
 * True when the `description` value continues on a line the loader drops: the line after the
 * field is neither blank nor a new `key:` field. `parseSkillFrontmatter` reads one line per
 * field, so the rest of a wrapped description never reaches what an Agent is shown.
 */
function wrappedDescription(lines) {
  const at = lines.findIndex((line) => line.trim().startsWith("description:"));
  if (at < 0) return false;
  return lines
    .slice(at + 1)
    .some((line) => line.trim() !== "" && !/^[A-Za-z_][A-Za-z0-9_-]*\s*:/.test(line.trim()));
}

/**
 * Every link target in a Markdown file: inline `[text](target)` and reference definitions
 * `[id]: target`. Fenced blocks and code spans are removed first — a link inside an example is
 * prose about a link, not one a model is meant to follow.
 */
function linkTargets(content) {
  const prose = content
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/~~~[\s\S]*?(?:~~~|$)/g, "")
    .replace(/`[^`\n]*`/g, "");
  const targets = [];
  for (const match of prose.matchAll(/\]\(\s*([^)\s]+)/g)) targets.push(match[1]);
  for (const match of prose.matchAll(/^\s*\[[^\]]+\]:\s*(\S+)/gm)) targets.push(match[1]);
  return targets;
}

/** The path of a target this guard is meant to resolve, or null (an anchor, a URL, an absolute path). */
function localTarget(target) {
  const clean = target.split("#")[0].split("?")[0];
  if (clean === "") return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(clean)) return null;
  if (clean.startsWith("/")) return null;
  return clean;
}

if (!existsSync(PLUGINS)) {
  console.error(`plugin skills: no plugins/ directory under ${ROOT}`);
  process.exit(1);
}

const pluginDirs = readdirSync(PLUGINS, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(PLUGINS, entry.name))
  .sort();

// Rule 4, over the whole tree rather than the skill directories: a manifest anywhere under
// `plugins/` is one the library reads, and the version is what an installed copy compares.
const manifests = filesUnder(PLUGINS).filter((file) => path.posix.basename(file) === "plugin.json");
for (const file of manifests) {
  const abs = path.join(PLUGINS, file);
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    report(
      "manifest",
      posix(abs),
      `does not parse as JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
    continue;
  }
  const version = manifest?.version;
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    report("manifest", posix(abs), `version ${JSON.stringify(version)} is not YYYY.MM.DD.N`);
  }
}

const skills = [];
for (const pluginDir of pluginDirs) {
  const skillsDir = path.join(pluginDir, "skills");
  if (!existsSync(skillsDir)) continue;
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory())
      skills.push({ dir: path.join(skillsDir, entry.name), name: entry.name });
  }
}
skills.sort((a, b) => (posix(a.dir) < posix(b.dir) ? -1 : 1));

/** Every SKILL.md read, as `{ dirName, file, content }`, for rule 5. */
const skillContents = [];

/** Skill name → the SKILL.md that claimed it first, for rule 2. */
const firstOwner = new Map();
let referenceFiles = 0;

for (const skill of skills) {
  const skillFile = path.join(skill.dir, "SKILL.md");
  const present = new Set(filesUnder(skill.dir));
  const shipped = [...present].filter((file) => !NOT_CONTENT.has(file));
  referenceFiles += shipped.length;

  // Rule 1: the frontmatter the loader parses.
  if (!present.has("SKILL.md")) {
    report("frontmatter", posix(skillFile), "skill directory holds no SKILL.md");
    continue;
  }
  const skillContent = readFileSync(skillFile, "utf8");
  skillContents.push({ dirName: skill.name, file: skillFile, content: skillContent });
  const header = frontmatter(skillContent);
  if (header === null) {
    report("frontmatter", posix(skillFile), "no `---` frontmatter block at the start of the file");
  } else {
    const name = header.fields["name"];
    if (!name) report("frontmatter", posix(skillFile), "frontmatter carries no `name`");
    else if (name !== skill.name) {
      report(
        "frontmatter",
        posix(skillFile),
        `frontmatter name "${name}" differs from its directory "${skill.name}" — the loader installs the directory's name`,
      );
    }
    if (!header.fields["description"]) {
      report("frontmatter", posix(skillFile), "frontmatter carries no non-empty `description`");
    } else if (wrappedDescription(header.lines)) {
      report("frontmatter", posix(skillFile), "`description` wraps onto a line the loader drops");
    }
  }

  // Rule 2: one flat installation directory, so the name must be the library's alone.
  const owner = firstOwner.get(skill.name);
  if (owner === undefined) firstOwner.set(skill.name, posix(skillFile));
  else {
    report(
      "unique-name",
      posix(skillFile),
      `skill name "${skill.name}" is already shipped by ${owner} — both install into agent_state/skills/${skill.name}/`,
    );
  }

  // Rule 3a: every relative link resolves to a file this skill ships, and only to one of those.
  const resolved = new Map();
  for (const file of ["SKILL.md", ...shipped]) {
    const abs = path.join(skill.dir, file);
    const targets = new Set();
    // A target linked more than once is one broken target, not one fault per occurrence.
    for (const target of new Set(linkTargets(readFileSync(abs, "utf8")))) {
      const clean = localTarget(target);
      if (clean === null) continue;
      const inside = path
        .relative(skill.dir, path.resolve(path.dirname(abs), clean))
        .split(path.sep)
        .join("/");
      if (inside.startsWith("..") || !present.has(inside)) {
        const leaves = inside.startsWith("..")
          ? " (it leaves the skill directory, which installs on its own)"
          : "";
        report(
          "links",
          posix(abs),
          `broken link: "${target}" does not resolve to a file this skill ships${leaves}`,
        );
        continue;
      }
      targets.add(inside);
    }
    resolved.set(file, targets);
  }

  // Rule 3b: a shipped reference file no link leads to is one no model ever learns about.
  const reachable = new Set(["SKILL.md"]);
  const queue = ["SKILL.md"];
  while (queue.length > 0) {
    for (const next of resolved.get(queue.pop()) ?? []) {
      if (reachable.has(next)) continue;
      reachable.add(next);
      queue.push(next);
    }
  }
  for (const file of shipped) {
    if (file.endsWith(".md") && !reachable.has(file)) {
      report(
        "links",
        posix(path.join(skill.dir, file)),
        "unreachable reference: no link from SKILL.md leads to it",
      );
    }
  }
}

// Rule 5: every command a skill names is one this checkout's CLI registers.
const cliDir = path.relative(REPO_ROOT, CLI_COMMANDS).split(path.sep).join("/");
let commands = null;
try {
  commands = readCliCommands(CLI_COMMANDS, { root: REPO_ROOT });
} catch (err) {
  const untraced = err instanceof Error && Array.isArray(err.untraced) ? err.untraced : null;
  if (untraced === null) {
    report(
      "commands",
      cliDir,
      `the CLI registration cannot be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  } else {
    for (const entry of untraced) {
      report("commands", cliDir, `a registration this guard cannot trace: ${entry}`);
    }
  }
}
let commandsCovered;
if (commands === null) {
  commandsCovered = `${skillContents.length} skills not measured — the CLI registration was not read`;
} else {
  const { invocations, mismatches } = measureSkills(skillContents, commands);
  /** file → lines already named, so a repeated invocation names each of its lines once. */
  const named = new Map();
  for (const item of mismatches) {
    const { content } = skillContents.find((skill) => skill.file === item.file);
    const used = named.get(item.file) ?? new Set();
    named.set(item.file, used);
    const at = content
      .split("\n")
      .findIndex((line, index) => !used.has(index) && line.includes(`penguin ${item.text}`));
    if (at >= 0) used.add(at);
    const where = at >= 0 ? `line ${at + 1}: ` : "";
    report("commands", posix(item.file), `${where}\`penguin ${item.text}\` — ${item.mismatch}`);
  }
  const resolved = new Set();
  for (const invocation of invocations) {
    const result = resolveInvocation(invocation.tokens, commands);
    if (result.path !== undefined) resolved.add(result.path);
  }
  const silent = skillContents
    .filter((skill) => extractInvocations(skill.content).length === 0)
    .map((skill) => posix(path.dirname(skill.file)));
  commandsCovered =
    `${skillContents.length} skills, ${invocations.length} penguin invocations, ` +
    `${resolved.size} distinct commands, ${commands.size} CLI registrations read from ` +
    `${cliDir}; ` +
    `${silent.length} skill(s) naming no penguin command` +
    (silent.length > 0 ? `: ${silent.join(", ")}` : "");
}
const commandsLine = `plugin skills: commands — ${commandsCovered}`;

const covered = [
  `${pluginDirs.length} plugin directories`,
  `${manifests.length} plugin.json manifests`,
  `${skills.length} skills (${firstOwner.size} distinct names)`,
  `${referenceFiles} reference files`,
].join(", ");
const rules = `rules checked: ${RULES.join(", ")}`;

if (violations.length === 0) {
  console.log(`plugin skills: ok — ${covered}; ${rules}`);
  console.log(commandsLine);
  process.exit(0);
}
console.error(`plugin skills: ${violations.length} violation(s) — ${covered}; ${rules}`);
console.error(commandsLine);
for (const violation of violations) {
  console.error(`  [${violation.rule}] ${violation.file}: ${violation.message}`);
}
process.exit(1);
