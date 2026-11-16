/**
 * The skill/hook plugin library as something a hot push carries.
 *
 * Core reads the library through Node from a "host package" — the package whose
 * `dependencies` name the `@penguinharness/*` plugin packages (packages/core/src/plugin/
 * library-host.ts); for the server that is its own package.
 * A pushed platform bundle sits in the data root's store, where nothing above it is a
 * package, so it fell back to the program that booted it: a machine installed before a
 * plugin existed never offered that plugin, however new its platform was. Creating an
 * organization installs `agent-company` on its CEO, and on a program that predates company
 * mode every attempt answered "This plugin is not in the plugin library".
 *
 * So the push carries the library it was built with, as one archive laid out as that host
 * package: `library/package.json` (the dependency list) and
 * `library/node_modules/@penguinharness/<name>/…` (each plugin directory as it is in the
 * repo, with the `ifaces.json` its build writes — what the library reads a plugin's content from
 * — and without the `src/` and `tsconfig.json` that build reads, which nothing on the target
 * does). The platform points core at it at boot (server hmr/platform.ts,
 * `usePushedPluginLibrary`).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const PREFIX = "@penguinharness/";
/** Never part of a plugin's content: what its build reads (`src/`, `tsconfig.json`), its tests, its dependencies. */
const SKIP = new Set(["node_modules", "test", "tests", "src", "tsconfig.json"]);

/**
 * Writes each plugin's `ifaces.json` the way its own `build` does (gen-ifaces over its
 * tsconfig), a few at a time: the table is generated, never committed, and a push must carry the
 * one of the revision being pushed. Needs core's dist (the decorators' declarations), as the
 * server's own table does.
 */
async function buildTables(repoRoot, dirs) {
  const run = promisify(execFile);
  const generator = path.join(repoRoot, "scripts", "gen-ifaces.mjs");
  const queue = [...dirs];
  const worker = async () => {
    for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
      await run(process.execPath, [
        generator,
        "--project",
        path.join(dir, "tsconfig.json"),
        "--out",
        path.join(dir, "ifaces.json"),
      ]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(queue.length, os.availableParallelism()) }, worker),
  );
}

async function walk(dir, rel = "") {
  const out = [];
  for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || (rel === "" && SKIP.has(entry.name))) continue;
    const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await walk(path.join(dir, entry.name), childRel)));
    else if (entry.isFile()) out.push(childRel);
  }
  return out;
}

/**
 * `{ entries, names, cleanup }`: archive entries (`{ rel, abs, exec }`, see asset-archives.mjs)
 * for the library the server's own package.json declares, under `library/`. `cleanup` removes
 * the generated manifest's temp directory once the archive is packed.
 */
export async function libraryPayload(repoRoot) {
  const server = JSON.parse(
    await fsp.readFile(path.join(repoRoot, "packages", "server", "package.json"), "utf8"),
  );
  const deps = Object.keys(server.dependencies ?? {})
    .filter((dep) => dep.startsWith(PREFIX))
    .sort();
  const dirs = deps.map((dep) => path.join(repoRoot, "plugins", dep.slice(PREFIX.length)));
  for (const [i, dir] of dirs.entries()) {
    if (
      !fs.existsSync(path.join(dir, "package.json")) ||
      !fs.existsSync(path.join(dir, "tsconfig.json"))
    ) {
      throw new Error(
        `${deps[i]} is a dependency of the server but ${dir} holds no plugin package to build (package.json and tsconfig.json)`,
      );
    }
  }
  await buildTables(repoRoot, dirs);
  const entries = [];
  for (const [i, dep] of deps.entries()) {
    const dir = dirs[i];
    for (const rel of await walk(dir)) {
      entries.push({
        rel: `library/node_modules/${dep}/${rel}`,
        abs: path.join(dir, ...rel.split("/")),
        exec: false,
      });
    }
  }
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-library-"));
  const manifest = path.join(stage, "package.json");
  await fsp.writeFile(
    manifest,
    `${JSON.stringify(
      {
        name: "penguin-plugin-library",
        private: true,
        version: "0.0.0",
        dependencies: Object.fromEntries(deps.map((dep) => [dep, "*"])),
      },
      null,
      2,
    )}\n`,
  );
  entries.push({ rel: "library/package.json", abs: manifest, exec: false });
  return {
    entries,
    names: deps.map((dep) => dep.slice(PREFIX.length)),
    cleanup: () => fsp.rm(stage, { recursive: true, force: true }),
  };
}
