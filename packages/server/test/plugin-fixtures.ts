/**
 * Plugin packages on disk, in the shape a built plugin has: a `package.json`, the
 * generated `ifaces.json` beside it (the module payload), and an entry whose default export
 * names the module classes. Plugin source is written the way a plugin author writes it
 * and lowered the way its build would lower it, so the fixture exercises the same
 * decorators the host reads.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

/**
 * The decorators, as a plugin's bundle would carry them — here imported from this
 * checkout's built SDK by file URL, since a package under a temp dir resolves nothing.
 */
export const decorators = new URL("../../core/dist/plugin/index.js", import.meta.url).href;

/** Plugin source as a plugin author writes it, lowered the way its build would lower it. */
export function lower(source: string): string {
  return ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
}

export interface ClassPackage {
  name: string;
  /** The one module class the package exports (a `@Module()` with nothing to require or provide). */
  module: string;
  /** package.json `main`; default `./index.js`. */
  main?: string;
  /** package.json `exports`, when the package declares them. */
  exports?: unknown;
  /** The entry's source, when it is not the default class (a package that throws on import, say). */
  index?: string;
}

/** Writes one plugin package into `dir` and returns its entry file. */
export async function writeClassPackage(dir: string, pkg: ClassPackage): Promise<string> {
  const main = pkg.main ?? "./index.js";
  const entry = path.join(dir, main);
  await mkdir(path.dirname(entry), { recursive: true });
  await writeFile(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: pkg.name,
      type: "module",
      main,
      ...(pkg.exports !== undefined ? { exports: pkg.exports } : {}),
    }),
    "utf8",
  );
  await writeFile(
    path.join(dir, "ifaces.json"),
    JSON.stringify({
      ifaces: {},
      types: {},
      modules: {
        [pkg.module]: {
          name: pkg.module,
          requires: {},
          provides: {},
          contributes: {},
          children: [],
        },
      },
      plugin: { modules: [pkg.module], replaces: [] },
    }),
    "utf8",
  );
  await writeFile(
    entry,
    pkg.index ??
      lower(`import { Module } from ${JSON.stringify(decorators)};
             @Module() export class ${pkg.module} {}
             export default { modules: [${pkg.module}] };`),
    "utf8",
  );
  return entry;
}

/** What a package of content declares (core plugin/library.ts); each entry gets the id the shipped plugins use. */
export interface PluginContent {
  card?: Record<string, unknown>;
  /** Skill names, each at `skills/<name>`. */
  skills?: string[];
  /** The hook package: its `version` and commands, at `hooks/`. */
  hooks?: Record<string, unknown>;
  mcpServers?: Array<Record<string, unknown>>;
  workbenches?: string[];
}

/**
 * The `ifaces.json` gen-ifaces writes for a package whose one component declares `content` to
 * the plugin library's slots — what a content plugin's build leaves beside its package.json.
 */
export function contentTable(packageName: string, content: PluginContent): string {
  const plugin = packageName.slice(packageName.lastIndexOf("/") + 1);
  const contributes: Record<string, Array<Record<string, unknown>>> = {};
  if (content.card !== undefined)
    contributes["PluginLibraryModule.cards"] = [{ id: `${plugin}.card`, ...content.card }];
  if (content.skills !== undefined)
    contributes["PluginLibraryModule.skills"] = content.skills.map((name) => ({
      id: `${plugin}.skill.${name}`,
      name,
      path: `skills/${name}`,
    }));
  if (content.hooks !== undefined)
    contributes["PluginLibraryModule.hooks"] = [
      { id: `${plugin}.hooks`, path: "hooks", ...content.hooks },
    ];
  if (content.mcpServers !== undefined)
    contributes["PluginLibraryModule.mcpServers"] = content.mcpServers.map((server) => ({
      id: `${plugin}.mcp.${String(server.name)}`,
      ...server,
    }));
  if (content.workbenches !== undefined)
    contributes["PluginLibraryModule.workbenches"] = content.workbenches.map((name) => ({
      id: `${plugin}.workbench.${name}`,
      name,
      path: `workbenches/${name}`,
    }));
  const key = `${packageName}#Content`;
  return JSON.stringify({
    ifaces: { [key]: { name: "Content", methods: {}, slots: {} } },
    types: {},
    modules: {
      Content: {
        name: "Content",
        kind: "component",
        requires: {},
        provides: { Content: key },
        contributes,
        children: [],
      },
    },
    plugin: { modules: ["Content"], replaces: [] },
  });
}

/**
 * Writes `files` (paths relative to the package directory) as package `packageName` in the
 * data root's plugin prefix and lists it there, as an admin's install leaves it: the library
 * then carries it. Earlier packages written this way stay listed.
 */
export async function writePrefixPackage(
  root: string,
  packageName: string,
  files: Record<string, string>,
): Promise<string> {
  const prefix = path.join(root, "plugins");
  const dir = path.join(prefix, "node_modules", ...packageName.split("/"));
  for (const [rel, body] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
    await writeFile(path.join(dir, rel), body, "utf8");
  }
  const manifest = path.join(prefix, "package.json");
  const listed = await readFile(manifest, "utf8").then(
    (text) => JSON.parse(text) as { dependencies?: Record<string, string> },
    () => ({ dependencies: {} }),
  );
  await writeFile(
    manifest,
    JSON.stringify({
      name: "penguin-plugins",
      private: true,
      dependencies: { ...listed.dependencies, [packageName]: "*" },
    }),
    "utf8",
  );
  return dir;
}
