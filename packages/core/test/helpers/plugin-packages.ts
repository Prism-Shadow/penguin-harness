/**
 * Plugin packages as the library reads them, for tests: a `package.json` of npm fields and the
 * `ifaces.json` gen-ifaces writes for a package that carries only content — one empty component
 * whose `contributes` literal declares the package's card, Skills, hook package, MCP servers and
 * Workbench apps (core plugin/library.ts). The table has the generator's shape; the server's
 * live-library suite reads the real generated tables through the same reader, so the two cannot
 * part without a test failing. This spares a test the TypeScript build.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** What a fixture package declares; every entry gets the id the shipped plugins use. */
export interface PluginContent {
  card?: Record<string, unknown>;
  /** Skill names, each at `skills/<name>` (or `{ name, path }` for another directory). */
  skills?: Array<string | { name: string; path: string }>;
  /** The hook package: its `version` and commands; `path` defaults to `hooks`. */
  hooks?: Record<string, unknown>;
  mcpServers?: Array<Record<string, unknown>>;
  /** Workbench app names, each at `workbenches/<name>`. */
  workbenches?: string[];
  /** Extra slots, as written (e.g. a server module's own). */
  other?: Record<string, Array<Record<string, unknown>>>;
}

const unscoped = (packageName: string) => packageName.slice(packageName.lastIndexOf("/") + 1);

/** The `contributes` literal of a content plugin's module. */
export function contributes(
  plugin: string,
  content: PluginContent,
): Record<string, Array<Record<string, unknown>>> {
  const out: Record<string, Array<Record<string, unknown>>> = { ...content.other };
  if (content.card !== undefined) {
    out["PluginLibraryModule.cards"] = [{ id: `${plugin}.card`, ...content.card }];
  }
  if (content.skills !== undefined) {
    out["PluginLibraryModule.skills"] = content.skills.map((skill) => {
      const { name, path: at } =
        typeof skill === "string" ? { name: skill, path: `skills/${skill}` } : skill;
      return { id: `${plugin}.skill.${name}`, name, path: at };
    });
  }
  if (content.hooks !== undefined) {
    out["PluginLibraryModule.hooks"] = [{ id: `${plugin}.hooks`, path: "hooks", ...content.hooks }];
  }
  if (content.mcpServers !== undefined) {
    out["PluginLibraryModule.mcpServers"] = content.mcpServers.map((server) => ({
      id: `${plugin}.mcp.${String(server.name)}`,
      ...server,
    }));
  }
  if (content.workbenches !== undefined) {
    out["PluginLibraryModule.workbenches"] = content.workbenches.map((name) => ({
      id: `${plugin}.workbench.${name}`,
      name,
      path: `workbenches/${name}`,
    }));
  }
  return out;
}

/** The ifaces.json of a package whose default export lists one component, `module`, contributing `content`. */
export function pluginTable(
  packageName: string,
  content: PluginContent,
  module = "FixturePlugin",
): Record<string, unknown> {
  const key = `${packageName}#${module}`;
  return {
    ifaces: { [key]: { name: module, methods: {}, slots: {} } },
    types: {},
    modules: {
      [module]: {
        name: module,
        kind: "component",
        requires: {},
        provides: { [module]: key },
        contributes: contributes(unscoped(packageName), content),
        children: [],
      },
    },
    plugin: { modules: [module], replaces: [] },
  };
}

/** A plugin package's two manifest files: `npm` (its package.json, `name` included) and the table declaring `content`. */
export function pluginPackage(
  npm: { name: string } & Record<string, unknown>,
  content: PluginContent,
): Record<string, string> {
  return {
    "package.json": JSON.stringify({ version: "1.0.0", ...npm }),
    "ifaces.json": JSON.stringify(pluginTable(npm.name, content)),
  };
}

/** Writes `files` under `dir` (paths relative to it; a Uint8Array is written as bytes). */
export async function writeFiles(
  dir: string,
  files: Record<string, string | Uint8Array>,
): Promise<void> {
  for (const [rel, data] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await fs.writeFile(path.join(dir, rel), data);
  }
}

/**
 * A host package at `dir` whose dependencies are `packages` (npm name → files), each written
 * under its `node_modules/` the way npm installs it. Returns `dir`.
 */
export async function libraryHost(
  dir: string,
  packages: Record<string, Record<string, string | Uint8Array>>,
): Promise<string> {
  await writeFiles(dir, {
    "package.json": JSON.stringify({
      name: "fixture-host",
      private: true,
      dependencies: Object.fromEntries(Object.keys(packages).map((name) => [name, "*"])),
    }),
  });
  for (const [name, files] of Object.entries(packages)) {
    await writeFiles(path.join(dir, "node_modules", ...name.split("/")), files);
  }
  return dir;
}

/** A SKILL.md with a name, a description and, when given, a dated version. */
export const skillFile = (name: string, version?: string, body = "## Before you start\n") =>
  `---\nname: ${name}\ndescription: Do ${name}.\n${version === undefined ? "" : `version: ${version}\n`}---\n\n${body}`;
