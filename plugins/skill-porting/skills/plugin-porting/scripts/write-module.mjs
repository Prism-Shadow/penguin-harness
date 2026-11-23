#!/usr/bin/env node
// Writes the module of a PenguinHarness plugin package being ported: `src/index.ts`, whose
// `@Component({ contributes })` literal declares everything the plugin carries, the
// `tsconfig.json` the build compiles, and the build wiring in `package.json`.
//
//   node write-module.mjs <package dir> --core "$(penguin version)"
//                         [--card <card.json>] [--mcp <mcp.json>]
//
// - The plugin name is the package name after its scope (`@ported/cloudflare` → `cloudflare`).
// - Every `skills/<name>/SKILL.md` becomes a `PluginLibraryModule.skills` entry; a Skill the
//   module does not name is not installed, so run this again after adding or renaming one.
// - `--card` is a JSON object of card fields (`title`, `titleZh`, `descriptionZh`,
//   `shortDescription`, `shortDescriptionZh`, `category`, `icon`, `quickStart`, `references`,
//   `preinstall`): the `PluginLibraryModule.cards` entry. Other keys are dropped and named.
// - `--mcp` is what port-mcp.mjs printed: its `mcpServers` become the
//   `PluginLibraryModule.mcpServers` entries.
// - Every entry gets the id the shipped plugins use (`<plugin>.card`, `<plugin>.skill.<name>`,
//   `<plugin>.mcp.<name>`).
// - `--core` is the PenguinHarness version the plugin is built for (`v0.2.19` or
//   `v0.2.19-3-gabc1234`): `package.json` gains `"type": "module"`, the `build` script and the
//   devDependencies the build needs — `@prismshadow/penguin-core` at that version, which ships
//   the `penguin-gen-ifaces` generator, and `typescript`, which it compiles with.
// `npm install && npm run build` then writes `ifaces.json`, the table the server reads. Built-in
// modules only.
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const pkgDir = args[0];
const flag = (name) => {
  const at = args.indexOf(name);
  return at > 0 ? args[at + 1] : undefined;
};
if (pkgDir === undefined || pkgDir.startsWith("--")) {
  console.error(
    'usage: node write-module.mjs <package dir> --core "$(penguin version)" [--card <card.json>] [--mcp <mcp.json>]',
  );
  process.exit(2);
}
const fail = (message) => {
  console.error(`write-module: ${message}`);
  process.exit(1);
};
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return fail(`${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
};
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

const core = /^v?(\d+\.\d+\.\d+)/.exec(String(flag("--core") ?? "").trim())?.[1];
if (core === undefined)
  fail('--core needs the PenguinHarness version: --core "$(penguin version)"');

const pkgFile = path.join(pkgDir, "package.json");
const pkg = readJson(pkgFile);
if (!isRecord(pkg) || typeof pkg.name !== "string") fail(`${pkgFile}: no package name`);
const plugin = pkg.name.slice(pkg.name.lastIndexOf("/") + 1);
if (!/^[A-Za-z0-9_-]+$/.test(plugin)) fail(`${pkg.name}: the plugin name must match [A-Za-z0-9_-]`);

const notes = [];
const contributes = {};

const CARD_KEYS = [
  "title",
  "titleZh",
  "descriptionZh",
  "shortDescription",
  "shortDescriptionZh",
  "category",
  "icon",
  "quickStart",
  "references",
  "preinstall",
];
const cardFile = flag("--card");
if (cardFile !== undefined) {
  const card = readJson(cardFile);
  if (!isRecord(card)) fail(`${cardFile}: expected a JSON object of card fields`);
  const dropped = Object.keys(card).filter((key) => !CARD_KEYS.includes(key));
  if (dropped.length > 0) notes.push(`card: dropped ${dropped.join(", ")} (not card fields)`);
  const kept = Object.fromEntries(CARD_KEYS.filter((key) => key in card).map((k) => [k, card[k]]));
  contributes["PluginLibraryModule.cards"] = [{ id: `${plugin}.card`, ...kept }];
}

const skillsDir = path.join(pkgDir, "skills");
const skills = fs.existsSync(skillsDir)
  ? fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => fs.existsSync(path.join(skillsDir, name, "SKILL.md")))
      .sort()
  : [];
for (const name of skills) {
  if (!/^[A-Za-z0-9_-]+$/.test(name)) notes.push(`skills/${name}: not a skill name; left out`);
}
const named = skills.filter((name) => /^[A-Za-z0-9_-]+$/.test(name));
if (named.length > 0) {
  contributes["PluginLibraryModule.skills"] = named.map((name) => ({
    id: `${plugin}.skill.${name}`,
    name,
    path: `skills/${name}`,
  }));
}

const mcpFile = flag("--mcp");
if (mcpFile !== undefined) {
  const ported = readJson(mcpFile);
  const servers = Array.isArray(ported?.mcpServers) ? ported.mcpServers : [];
  if (servers.length > 0) {
    contributes["PluginLibraryModule.mcpServers"] = servers.map(({ id: _id, ...server }) => ({
      id: `${plugin}.mcp.${server.name}`,
      ...server,
    }));
  }
}

if (Object.keys(contributes).length === 0) {
  fail("nothing to declare: no card, no skills/<name>/SKILL.md and no MCP servers");
}

// The literal is JSON, which is a TypeScript literal as it stands: the generator reads it as
// data, and a `${KEY}` inside a double-quoted string stays text.
const literal = JSON.stringify({ contributes }, null, 2);
const className = `${plugin
  .split(/[-_]+/)
  .filter(Boolean)
  .map((word) => word[0].toUpperCase() + word.slice(1))
  .join("")
  .replace(/^(\d)/, "P$1")}Plugin`;
fs.mkdirSync(path.join(pkgDir, "src"), { recursive: true });
fs.writeFileSync(
  path.join(pkgDir, "src", "index.ts"),
  [
    'import { Component } from "@prismshadow/penguin-core/plugin";',
    'import type { Plugin } from "@prismshadow/penguin-core/plugin";',
    "",
    "/**",
    " * Everything this plugin carries, declared for the PenguinHarness plugin library. Data only:",
    " * the class has no body and the package no entry point; `npm run build` writes this literal",
    " * into ifaces.json.",
    " */",
    `@Component(${literal})`,
    `export class ${className} {}`,
    "",
    `export default { modules: [${className}] } satisfies Plugin;`,
    "",
  ].join("\n"),
);

const tsconfig = path.join(pkgDir, "tsconfig.json");
if (!fs.existsSync(tsconfig)) {
  const compilerOptions = {
    target: "es2022",
    module: "nodenext",
    moduleResolution: "nodenext",
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    types: [],
  };
  fs.writeFileSync(tsconfig, `${JSON.stringify({ compilerOptions, include: ["src"] }, null, 2)}\n`);
}

pkg.type ??= "module";
pkg.scripts = {
  ...(isRecord(pkg.scripts) ? pkg.scripts : {}),
  build: "penguin-gen-ifaces --project tsconfig.json --out ifaces.json",
};
pkg.devDependencies = {
  ...(isRecord(pkg.devDependencies) ? pkg.devDependencies : {}),
  "@prismshadow/penguin-core": `^${core}`,
  typescript: "^5.6.0",
};
fs.writeFileSync(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);

const counts = Object.entries(contributes).map(([slot, list]) => `${list.length} ${slot}`);
console.log(`wrote src/index.ts (${className}): ${counts.join(", ")}`);
for (const note of notes) console.log(note);
