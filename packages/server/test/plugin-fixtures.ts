/**
 * Plugin packages on disk, in the shape a built plugin has: a `package.json`, the
 * generated `ifaces.json` beside it (the module payload), and an entry whose default export
 * names the module classes. Plugin source is written the way a plugin author writes it
 * and lowered the way its build would lower it, so the fixture exercises the same
 * decorators the host reads.
 */
import { mkdir, writeFile } from "node:fs/promises";
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
