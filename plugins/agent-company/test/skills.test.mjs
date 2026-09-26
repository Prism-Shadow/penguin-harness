/**
 * Measures the company plugin's protocol against the harness it drives.
 *
 * `plugins/agent-company` is the operating protocol of every company-mode organization: seven
 * `skills/<name>/SKILL.md` files (employee, CEO, HR, finance, research, mirror, setup) that every
 * desk and every ticket session of an organization runs on, and nothing in the tree reads their
 * *content*. They are, above all, instructions to run `penguin` commands, and the command surface
 * belongs to `packages/cli/src/commands/*.ts` at the same revision — so a skill that tells an
 * employee to run a command the CLI does not register is a broken instruction, invisible until
 * someone follows it.
 *
 * This check reads that content and asserts three things:
 *
 * 1. **frontmatter** — every skill directory carries a `SKILL.md` whose first `---` block parses
 *    the way the library parses it (`parseSkillFrontmatter` in
 *    `packages/core/src/plugins/index.ts`: first `---` block, `key: value` lines, value trimmed)
 *    with a `name` and a non-empty single-line `description`. The loader takes a skill's name from
 *    its *directory* (`readSkillDir`), so a differing frontmatter name is a silent mismatch — it
 *    installs under the directory name and the frontmatter name reaches nobody.
 * 2. **commands** — every `penguin …` invocation inside a fenced block or an inline code span is
 *    resolved against the CLI's own registration, read statically from
 *    `packages/cli/src/commands/*.ts` (commander `.command("…")` chains, cross-file group
 *    registrations included). A named token that is not a registered subcommand of the resolved
 *    command and not one of its positional arguments is a mismatch.
 * 3. **the check itself fails when it should** — a skill naming a command that does not exist must
 *    make this file fail, and that case is a test here, so the guard cannot rot into a no-op.
 *
 * Boundaries — what this does not measure:
 * - an invocation written in prose rather than in a code span is not seen (the skills write every
 *   command in a span; frontmatter prose is deliberately out of scope);
 * - a group command invoked with a flag its group does not declare (`penguin org channel --nope`)
 *   resolves to the group and is not flagged: flags are not part of the registration read here;
 * - an argument value that happens to be a bare lowercase word and sits where a subcommand could
 *   sit is indistinguishable from one, so a group invoked with such a stray argument is reported
 *   as a mismatch — that is the intended direction (fail loudly, not silently);
 * - `packages/core/test/plugins.test.ts` and `packages/landing/test/skills-sync.test.ts` read a
 *   `SKILL.md` too (frontmatter through the loader, and one file per listed skill directory) — this
 *   file is the only reader of the *commands* a skill names;
 * - a relative link, a stale path or a `reference/` file is not measured here.
 *
 * The seven skills must keep the `name`/`description` frontmatter the library reads, and content
 * changes are the plugin's own business: a skill that has to change owes a `plugin.json` version
 * bump (`scripts/check-plugin-versions.mjs`), which is why this file changes none of them.
 */

// Run it with the repo's Node, no install and no dependency:
//
//     node --test plugins/agent-company/test/*.test.mjs
//
// The shell expands the `*` before the runner sees it, so that is the one form true on both Node
// lines this repo lives on: 7 tests / 7 pass / 0 fail on the system Node v18.20.4 and on the Node
// v24.18.0 the root `package.json` requires (`engines.node >= 24`). Each of the other two forms
// works on one line only, and the difference is how the runner treats its argument, not this test:
//
//     node --test plugins/agent-company/test/                # Node 18 only
//     node --test 'plugins/agent-company/test/**/*.test.mjs' # Node 22+ only
//
// From Node 22 on, a bare *directory* argument is run as a file, so the first form fails on Node 24
// with `Cannot find module '…/plugins/agent-company/test'`; and Node 18 does not expand a `**`
// segment itself, so the quoted pattern fails there. (Both were measured on this host.)
//
// Node builtins only on purpose: `plugins/agent-company/package.json` is a published manifest with
// no `scripts` and no `devDependencies`, and that stays true.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const PLUGIN_DIR = path.join(REPO_ROOT, "plugins", "agent-company");
const SKILLS_DIR = path.join(PLUGIN_DIR, "skills");
const CLI_COMMANDS_DIR = path.join(REPO_ROOT, "packages", "cli", "src", "commands");
const CORE_PLUGIN_LOADER = path.join(REPO_ROOT, "packages", "core", "src", "plugins", "index.ts");

/** The seven skills this plugin is the protocol of, as `<skills>/<name>/` directories. */
const COMPANY_SKILLS = [
  "company-ceo",
  "company-employee",
  "company-finance",
  "company-hr",
  "company-mirror",
  "company-research",
  "company-setup",
];

/** Version format a library manifest must carry: `YYYY.MM.DD.N` (PLUGIN_VERSION_PATTERN in core). */
const PLUGIN_VERSION_PATTERN = /^\d{4}\.\d{2}\.\d{2}\.\d+$/;

// ---------------------------------------------------------------------------------------------
// What the plugin loader reads
// ---------------------------------------------------------------------------------------------

/**
 * The library's own frontmatter reader, mirrored line for line from
 * `parseSkillFrontmatter` in `packages/core/src/plugins/index.ts` (a `.ts` module this check cannot
 * import without a build): the first `---` block, `key: value` per line split on the first colon
 * with the value trimmed, `name` required. A wrapped `description:` reads as the empty string here
 * exactly as it does in the loader — that is the point of mirroring rather than improving it.
 */
function parseSkillFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content.replace(/^\ufeff/, ""));
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    if (key) fields[key] = line.slice(idx + 1).trim();
  }
  const name = fields["name"];
  if (!name) return null;
  return { name, description: fields["description"] ?? "" };
}

/** Every skill directory this plugin ships, in name order, each with its SKILL.md. */
function readSkills() {
  const entries = fs
    .readdirSync(SKILLS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return entries.map((dirName) => {
    const file = path.join(SKILLS_DIR, dirName, "SKILL.md");
    assert.ok(
      fs.existsSync(file),
      `${path.relative(REPO_ROOT, file)} is missing: a skill directory carries a SKILL.md`,
    );
    return { dirName, file, content: fs.readFileSync(file, "utf8") };
  });
}

/** The skills shipped as read, or a failure naming every frontmatter the loader would read wrongly. */
function assertSkillFrontmatter(skills) {
  const problems = [];
  for (const skill of skills) {
    const relative = path.relative(REPO_ROOT, skill.file);
    const meta = parseSkillFrontmatter(skill.content);
    if (meta === null) {
      problems.push(`${relative}: no frontmatter with a name (the loader refuses the skill)`);
      continue;
    }
    if (meta.name !== skill.dirName) {
      problems.push(
        `${relative}: frontmatter name "${meta.name}" differs from the directory "${skill.dirName}" — ` +
          `the loader installs it as "${skill.dirName}", so the frontmatter name reaches nobody`,
      );
    }
    const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(skill.content.replace(/^\ufeff/, ""))[1];
    if (meta.description === "") {
      problems.push(
        `${relative}: the loader reads an empty description (a value on the next line?)`,
      );
    } else if (!block.split(/\r?\n/).some((line) => /^description: \S/.test(line))) {
      problems.push(
        `${relative}: description is not one \`description: value\` line inside the frontmatter block`,
      );
    }
  }
  if (problems.length > 0) {
    assert.fail(`skill frontmatter the plugin loader cannot read:\n  - ${problems.join("\n  - ")}`);
  }
}

// ---------------------------------------------------------------------------------------------
// The CLI command surface
// ---------------------------------------------------------------------------------------------

const COMMAND_DECLARATION =
  /(?:const\s+([A-Za-z_$][\w$]*)\s*=\s*)?([A-Za-z_$][\w$]*)\s*\.\s*command\(\s*(["'])([^"']*)\3/g;
const REGISTER_FUNCTION = /export function (register[A-Za-z0-9_]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*:/g;
const REGISTER_CALL = /(register[A-Za-z0-9_]*)\s*\(\s*([A-Za-z_$][\w$]*)\s*,/g;

/**
 * The commands `packages/cli/src/commands/*.ts` registers at this revision, as full paths
 * (`"org ticket block"`) with the number of positional arguments the registration declares
 * (`.command("block <ticket_id>")` → 1, `.command("ls")` → 0). Read statically — the CLI's own
 * `commander` dependency is not installed here — by walking `X.command("name …")` declarations
 * where `X` is `program` or a variable that already holds a command path, across files: a group is
 * registered in one function and its subcommands in another (`registerServeCommands` passes its
 * `server` command to `registerStatusCommand`), so call sites are resolved too, to a fixed point.
 *
 * A `.command(…)` whose receiver cannot be traced is reported rather than skipped: silently
 * shrinking the surface would turn a broken instruction into a passing check.
 */
function readCliCommands() {
  const files = fs
    .readdirSync(CLI_COMMANDS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
    .map((entry) => entry.name)
    .sort();
  assert.ok(
    files.length > 0,
    `no command modules under ${path.relative(REPO_ROOT, CLI_COMMANDS_DIR)}`,
  );

  const sources = new Map(
    files.map((file) => [file, fs.readFileSync(path.join(CLI_COMMANDS_DIR, file), "utf8")]),
  );
  // file → variable name → command path it holds; `program` is the root.
  const variables = new Map(files.map((file) => [file, new Map([["program", ""]])]));
  const functionParam = new Map();
  const calls = [];
  for (const [file, source] of sources) {
    for (const match of source.matchAll(REGISTER_FUNCTION)) {
      functionParam.set(match[1], { file, param: match[2] });
    }
    for (const match of source.matchAll(REGISTER_CALL)) {
      calls.push({ file, name: match[1], argument: match[2] });
    }
  }

  const commands = new Map();
  const scan = (collectUntraced) => {
    for (const [file, source] of sources) {
      const vars = variables.get(file);
      for (const match of source.matchAll(COMMAND_DECLARATION)) {
        const [, declared, receiver, , raw] = match;
        const parent = vars.get(receiver);
        if (parent === undefined) {
          if (collectUntraced)
            collectUntraced.push(`${file}: .command("${raw.trim()}") on "${receiver}"`);
          continue;
        }
        const name = raw.trim().split(/\s+/)[0];
        const fullPath = parent === "" ? name : `${parent} ${name}`;
        if (declared !== undefined) vars.set(declared, fullPath);
        commands.set(fullPath, { path: fullPath, arity: raw.trim().split(/\s+/).length - 1 });
      }
    }
    // A group registered in one module and extended in another: `registerX(server, t)` binds
    // registerX's own parameter to the path `server` holds at the call site.
    for (const call of calls) {
      const target = functionParam.get(call.name);
      if (target === undefined) continue;
      const parentPath = variables.get(call.file).get(call.argument);
      if (parentPath === undefined) continue;
      const targetVars = variables.get(target.file);
      if (!targetVars.has(target.param)) targetVars.set(target.param, parentPath);
    }
  };

  for (let pass = 0; pass < 5; pass++) scan(null);
  const untraced = [];
  scan(untraced);
  assert.deepEqual(
    untraced,
    [],
    `command registrations this check cannot trace — the surface would be measured only in part:\n  - ${untraced.join("\n  - ")}`,
  );
  return commands;
}

// ---------------------------------------------------------------------------------------------
// The invocations a skill names
// ---------------------------------------------------------------------------------------------

/**
 * The text regions a `penguin` invocation can live in: the lines of every fenced block and every
 * inline code span, minus the inside of a double-quoted argument (`--prompt "… run penguin …"` is
 * prose an employee reads, not a command the skill tells anyone to run).
 */
function commandSegments(content) {
  const segments = [];
  for (const match of content.matchAll(/```[^\n]*\n([\s\S]*?)```/g))
    segments.push(...match[1].split("\n"));
  const outsideFences = content.replace(/```[^\n]*\n[\s\S]*?```/g, (block) =>
    " ".repeat(block.length),
  );
  for (const match of outsideFences.matchAll(/`([^`\n]+)`/g)) segments.push(match[1]);
  return segments.flatMap((segment) => segment.split('"').filter((_, index) => index % 2 === 0));
}

/** Every `penguin …` invocation in a skill, as the raw text and its whitespace-separated tokens. */
function extractInvocations(content) {
  const invocations = [];
  for (const segment of commandSegments(content)) {
    for (const match of segment.matchAll(/\bpenguin\s+([^\s].*)$/g)) {
      const text = match[1].trim();
      const tokens = text.split(/\s+/).filter((token) => token !== "");
      if (tokens.length > 0) invocations.push({ text, tokens });
    }
  }
  return invocations;
}

/** A bare command-name token: what a subcommand is written as (`block`, `channel`, `ticket`). */
const isCommandWord = (token) => /^[a-z][a-z0-9-]*$/.test(token);

/**
 * Resolves one invocation against the registry: descend as long as the next token is a registered
 * subcommand of the path so far, then read the command's positional arguments. Tokens that are
 * placeholders (`<ticket_id>`), flags (`--json`), grouped flags (`[--json]`) or a trailing comment
 * (`# …`) are not positionals; a bare word that is not a registered subcommand and does not fit the
 * command's arity is the mismatch this check exists for.
 */
function resolveInvocation(tokens, commands) {
  let resolved = "";
  let index = 0;
  while (index < tokens.length && isCommandWord(tokens[index])) {
    const candidate = resolved === "" ? tokens[index] : `${resolved} ${tokens[index]}`;
    if (!commands.has(candidate)) break;
    resolved = candidate;
    index++;
  }
  if (resolved === "") {
    return { mismatch: `\`${tokens[0]}\` is not a command the CLI registers` };
  }
  const { arity } = commands.get(resolved);
  const positional = [];
  for (; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.startsWith("-") || token.startsWith("#")) break;
    if (isCommandWord(token)) positional.push(token);
  }
  if (positional.length > arity) {
    return {
      mismatch:
        `\`${resolved}\` is a command with ${arity} positional argument(s), so \`${positional.join(" ")}\` ` +
        `is neither a subcommand of \`${resolved}\` nor one of its arguments`,
    };
  }
  return { path: resolved };
}

/** Every invocation in the given skills, with the mismatches among them. */
function measureSkills(skills, commands) {
  const invocations = [];
  const mismatches = [];
  for (const skill of skills) {
    for (const invocation of extractInvocations(skill.content)) {
      invocations.push({ skill: skill.dirName, ...invocation });
      const result = resolveInvocation(invocation.tokens, commands);
      if (result.mismatch !== undefined) {
        mismatches.push({
          skill: skill.dirName,
          file: skill.file,
          ...invocation,
          mismatch: result.mismatch,
        });
      }
    }
  }
  return { invocations, mismatches };
}

/** The measured invocations, or a failure naming every command the revision does not have. */
function assertSkillsAgainstCli(skills, commands) {
  const { invocations, mismatches } = measureSkills(skills, commands);
  if (mismatches.length > 0) {
    const lines = mismatches.map(
      (item) =>
        `${path.relative(REPO_ROOT, item.file)}: \`penguin ${item.text}\` — ${item.mismatch} ` +
        `(the surface is packages/cli/src/commands/*.ts at this revision)`,
    );
    assert.fail(
      `${mismatches.length} invocation(s) the skills tell an employee to run are not command(s) this revision's CLI registers:\n  - ${lines.join("\n  - ")}`,
    );
  }
  return invocations;
}

// ---------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------

test("the plugin ships the seven company skills, each with the frontmatter the loader reads", () => {
  const skills = readSkills();
  assert.deepEqual(
    skills.map((skill) => skill.dirName),
    COMPANY_SKILLS,
    "the company plugin is the protocol of the seven company-* skills",
  );
  assertSkillFrontmatter(skills);
});

test("the frontmatter check fails on a skill the loader would read wrongly", () => {
  const real = readSkills();
  const base = {
    dirName: "company-injected",
    file: path.join(SKILLS_DIR, "company-injected", "SKILL.md"),
    content: "---\nname: company-injected\ndescription: An injected skill.\n---\n\nBody.\n",
  };
  assert.doesNotThrow(
    () => assertSkillFrontmatter([...real, base]),
    "the injected shape is valid on its own",
  );

  const differingName = {
    ...base,
    content: base.content.replace("name: company-injected", "name: company-protocol"),
  };
  assert.throws(
    () => assertSkillFrontmatter([...real, differingName]),
    /company-protocol.*differs from the directory "company-injected"/,
    "a frontmatter name that differs from the directory installs under a different name than it claims",
  );

  const wrappedDescription = {
    ...base,
    content: "---\nname: company-injected\ndescription:\n  An injected skill.\n---\n\nBody.\n",
  };
  assert.throws(
    () => assertSkillFrontmatter([...real, wrappedDescription]),
    /reads an empty description/,
    "a description wrapped onto the next line reads as empty in the loader",
  );

  assert.doesNotThrow(
    () => assertSkillFrontmatter(real),
    "the real skills pass again once the injected case is gone",
  );
});

test("the CLI command surface the skills are measured against is readable", () => {
  const commands = readCliCommands();
  assert.ok(
    commands.size >= 50,
    `only ${commands.size} commands were read from ${path.relative(REPO_ROOT, CLI_COMMANDS_DIR)} — the static read is incomplete`,
  );
  for (const anchor of [
    "org",
    "org ticket block",
    "org channel send",
    "input",
    "logs",
    "cost",
    "schedule",
  ]) {
    assert.ok(commands.has(anchor), `\`penguin ${anchor}\` should be registered by the CLI`);
  }
  assert.equal(
    commands.get("org ticket block").arity,
    1,
    "`org ticket block <ticket_id>` takes one argument",
  );
  assert.equal(commands.get("org ticket ls").arity, 0, "`org ticket ls` takes none");
});

test("every command the seven skills tell an employee to run is registered by the CLI", (t) => {
  const skills = readSkills();
  const commands = readCliCommands();
  const invocations = assertSkillsAgainstCli(skills, commands);
  t.diagnostic(`measured ${skills.length} SKILL.md files, ${invocations.length} invocations`);
  t.diagnostic(
    `the CLI registration read from ${path.relative(REPO_ROOT, CLI_COMMANDS_DIR)}/*.ts holds ${commands.size} commands`,
  );

  // Coverage: the assertion above is only worth its cost if the extraction saw the protocol.
  const bySkill = new Map(COMPANY_SKILLS.map((name) => [name, 0]));
  for (const invocation of invocations)
    bySkill.set(invocation.skill, bySkill.get(invocation.skill) + 1);
  for (const [name, count] of bySkill) {
    assert.ok(
      count > 0,
      `${name} names no \`penguin\` command — the extraction missed it or the skill lost its commands`,
    );
  }
  const distinct = new Set(invocations.map((invocation) => invocation.tokens.join(" ")));
  const paths = new Set(
    [...distinct].map((text) => resolveInvocation(text.split(" "), commands).path),
  );
  t.diagnostic(
    `${distinct.size} distinct invocations, ${paths.size} distinct commands the skills run`,
  );
  assert.ok(
    invocations.length >= 100,
    `only ${invocations.length} invocations found across the seven skills`,
  );
  assert.ok(
    paths.size >= 25,
    `only ${paths.size} distinct commands measured across the seven skills`,
  );
});

test("the command check fails on a skill naming a command the CLI does not register", () => {
  const real = readSkills();
  const commands = readCliCommands();

  // `penguin org channel notify` is a real command of the *installed* harness (v0.2.13-238) and not
  // of the CLI this revision ships: exactly the cross-revision mismatch this check has to catch.
  const injected = {
    dirName: "company-injected",
    file: path.join(SKILLS_DIR, "company-injected", "SKILL.md"),
    content:
      "---\nname: company-injected\ndescription: An injected skill.\n---\n\n" +
      "Answer in the channel the trigger names: `penguin org channel notify <channel_id> <principal>…`.\n",
  };
  assert.throws(
    () => assertSkillsAgainstCli([...real, injected], commands),
    /org channel notify <channel_id>/,
    "a skill naming a command that does not exist must fail the check",
  );
  assert.throws(
    () =>
      assertSkillsAgainstCli(
        [
          ...real,
          {
            ...injected,
            content:
              "---\nname: company-injected\ndescription: x\n---\nInvoke `penguin org frobnicate 4`.\n",
          },
        ],
        commands,
      ),
    /frobnicate/,
    "an unknown command name is a mismatch too",
  );

  assert.doesNotThrow(
    () => assertSkillsAgainstCli(real, commands),
    "the seven real skills pass again once the injected case is removed",
  );
});

test("plugin.json satisfies the plugin loader's manifest contract", () => {
  const manifestFile = path.join(PLUGIN_DIR, "plugin.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.match(
    manifest.version,
    PLUGIN_VERSION_PATTERN,
    `${path.relative(REPO_ROOT, manifestFile)}: version must be YYYY.MM.DD.N`,
  );
  assert.equal(
    manifest.category,
    "agent-company",
    "the plugin's category groups it with the company playbooks",
  );
  assert.equal(typeof manifest.description, "string");
  assert.ok(
    manifest.description.trim().length > 0,
    "the plugin description is what the plugin page shows",
  );
  assert.equal(
    manifest.preinstall,
    false,
    "company mode is installed deliberately, not handed to default_agent",
  );

  // The version pattern is core's, not this file's: keep the mirror honest.
  const loader = fs.readFileSync(CORE_PLUGIN_LOADER, "utf8");
  assert.match(
    loader,
    /export const PLUGIN_VERSION_PATTERN = (\/[^\n]*\/);/,
    "core exports PLUGIN_VERSION_PATTERN",
  );
  const pattern = /export const PLUGIN_VERSION_PATTERN = (\/[^\n]*\/);/.exec(loader)[1];
  assert.equal(
    pattern,
    PLUGIN_VERSION_PATTERN.toString(),
    "the mirrored version pattern matches core's",
  );
  assert.match(
    loader,
    /export function parseSkillFrontmatter\(/,
    "core still exports parseSkillFrontmatter",
  );
});

test("package.json stays a dependency-free published manifest", () => {
  const manifestFile = path.join(PLUGIN_DIR, "package.json");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  assert.equal(
    manifest.scripts,
    undefined,
    `${path.relative(REPO_ROOT, manifestFile)} carries no scripts`,
  );
  assert.equal(
    manifest.devDependencies,
    undefined,
    "the check above runs on Node builtins, with no install",
  );
});
