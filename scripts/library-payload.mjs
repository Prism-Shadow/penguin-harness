/**
 * The skill/hook plugin library as something a hot push carries.
 *
 * Core reads the library through Node from a "host package" — the package whose
 * `dependencies` name the `@penguinharness/*` plugin packages (packages/core/src/plugins).
 * A pushed platform bundle sits in the data root's store, where nothing above it is a
 * package, so it fell back to the program that booted it: a machine installed before a
 * plugin existed never offered that plugin, however new its platform was. Creating an
 * organization installs `agent-company` on its CEO, and on a program that predates company
 * mode every attempt answered "This plugin is not in the plugin library".
 *
 * So the push carries the library it was built with, as one archive laid out as that host
 * package: `library/package.json` (the dependency list) and
 * `library/node_modules/@penguinharness/<name>/…` (each plugin directory as it is in the
 * repo — a plugin is committed content with no build). The platform points core at it at boot
 * (server hmr/platform.ts, `usePushedPluginLibrary`).
 */
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PREFIX = "@penguinharness/";
/** Never part of a plugin's content. */
const SKIP = new Set(["node_modules", "test", "tests"]);

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
 * for the library core's own package.json declares, under `library/`. `cleanup` removes the
 * generated manifest's temp directory once the archive is packed.
 */
export async function libraryPayload(repoRoot) {
  const core = JSON.parse(
    await fsp.readFile(path.join(repoRoot, "packages", "core", "package.json"), "utf8"),
  );
  const deps = Object.keys(core.dependencies ?? {})
    .filter((dep) => dep.startsWith(PREFIX))
    .sort();
  const entries = [];
  for (const dep of deps) {
    const name = dep.slice(PREFIX.length);
    const dir = path.join(repoRoot, "plugins", name);
    if (!fs.existsSync(path.join(dir, "plugin.json"))) {
      throw new Error(`${dep} is a dependency of core but ${dir} holds no plugin.json`);
    }
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
