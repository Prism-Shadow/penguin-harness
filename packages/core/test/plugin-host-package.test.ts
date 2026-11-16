/**
 * The plugin library's host package, where a pushed platform lives (plugin/library-host.ts).
 *
 * The library a push carried comes first, then the host package an embedder named
 * (useLibraryHost — the server names its own), then two fixed starting points, each walked upward
 * to the first package.json naming a plugin package: the installation the loader sits in, then
 * the installation of the running program (`process.argv[1]`). A hot-pushed platform bundle sits
 * in a data root's store, where nothing above it is a package, so the loader must not look at
 * import, and its plugins are the ones installed with the program that booted it. Pinned by
 * bundling the loader into a package-less scratch directory and running node against it, the way
 * the far side of a push does.
 *
 * - With no host anywhere the bundle still loads, and the library call fails naming every place.
 * - A named host is the library, whatever is installed beside the program; a push outranks it.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { compilePushBundle, pushBundleOptions } from "../../../scripts/push-bundle.mjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pluginPackage, skillFile } from "./helpers/plugin-packages.js";

const SRC = path.resolve(import.meta.dirname, "../src/plugin");

/** A built plugin package of one skill named like it, written at `dir`. */
function plugin(dir: string, name: string): void {
  const files = {
    ...pluginPackage({ name: `@penguinharness/${name}` }, { skills: [name] }),
    [`skills/${name}/SKILL.md`]: skillFile(name, "2026.10.01.1"),
  };
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
}
const GOAL_PLUGIN = (dir: string) => plugin(dir, "goal");
const HUMANIZER_PLUGIN = (dir: string) => plugin(dir, "humanizer");

/** A package.json anywhere above `dir` would make the scratch directory a host package. */
function packageJsonAbove(dir: string): string | null {
  for (let at = dir; ;) {
    const file = path.join(at, "package.json");
    if (fs.existsSync(file)) return file;
    const parent = path.dirname(at);
    if (parent === at) return null;
    at = parent;
  }
}

/** Runs a script that imports the bundle and reports the library call's outcome as JSON. */
function run(script: string): { loaded: boolean; names?: string[]; error?: string } {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`node exited ${result.status}: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split("\n").at(-1) ?? "{}") as ReturnType<typeof run>;
}

const script = (bundle: string) => `
import { loadLibraryPlugins } from ${JSON.stringify(pathToFileURL(bundle).href)};
try {
  console.log(JSON.stringify({ loaded: true, names: loadLibraryPlugins().map((p) => p.name) }));
} catch (err) {
  console.log(JSON.stringify({ loaded: true, error: err instanceof Error ? err.message : String(err) }));
}
`;

describe("the plugin library's host package", () => {
  let scratch: string;
  let bundle: string;

  beforeAll(async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-plugin-host-"));
    // The store a push lands in: `<root>/hmr/store/platform/<sha>.mjs`, nothing above it a package.
    bundle = path.join(scratch, "root", "hmr", "store", "platform", "platform.mjs");
    fs.mkdirSync(path.dirname(bundle), { recursive: true });
    // The library's three entry points, as the platform bundle carries them.
    const entry = path.join(scratch, "loader.ts");
    fs.writeFileSync(
      entry,
      [
        `export { loadLibraryPlugins } from ${JSON.stringify(path.join(SRC, "library-reader.ts"))};`,
        `export { useLibraryHost, usePushedPluginLibrary } from ${JSON.stringify(path.join(SRC, "library-host.ts"))};`,
      ].join("\n"),
    );
    // Compiled with the push's own options (scripts/push-bundle.mjs) rather than a hand-written
    // copy of them: only those carry the banner that declares the `require` a bundled CommonJS
    // dependency reaches for, and the loader — through @prismshadow/skills — now bundles one
    // (`yaml`), which without the banner dies at import with "Dynamic require of "process" is
    // not supported".
    await compilePushBundle(pushBundleOptions(entry, bundle));
    fs.rmSync(entry);
  });

  afterAll(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
  });

  it("loads with no host package anywhere, and the library call is what fails, naming both places", () => {
    // The precondition the far side of a push has: no package above the store or the program.
    expect(packageJsonAbove(path.dirname(bundle))).toBeNull();
    const program = path.join(scratch, "no-host.mjs");
    fs.writeFileSync(program, script(bundle));
    const outcome = run(program);
    expect(outcome.loaded).toBe(true);
    expect(outcome.error).toContain(
      `above the plugin loader at ${fs.realpathSync(path.dirname(bundle))} `,
    );
    expect(outcome.error).toContain(`or above the program at ${fs.realpathSync(scratch)}`);
  });

  it("reads the plugins installed beside the program that booted the bundle", () => {
    // An installation: `lib/package.json` names the plugin packages and carries them in its
    // own node_modules; the server was started from `lib/dist/`.
    const lib = path.join(scratch, "install", "lib");
    fs.mkdirSync(path.join(lib, "dist"), { recursive: true });
    fs.writeFileSync(
      path.join(lib, "package.json"),
      JSON.stringify({ name: "host", dependencies: { "@penguinharness/goal": "*" } }),
    );
    GOAL_PLUGIN(path.join(lib, "node_modules", "@penguinharness", "goal"));
    const program = path.join(lib, "dist", "serve.mjs");
    fs.writeFileSync(program, script(bundle));
    expect(run(program)).toEqual({ loaded: true, names: ["goal"] });
  });

  it("walks past a package.json it cannot read on the way up", () => {
    // Somebody else's file between the program and its host package: it answers nothing, and
    // it must not keep the walk from reaching the host package above it (the test above).
    fs.writeFileSync(path.join(scratch, "install", "lib", "dist", "package.json"), "{ not json");
    const program = path.join(scratch, "install", "lib", "dist", "serve.mjs");
    expect(run(program)).toEqual({ loaded: true, names: ["goal"] });
  });

  it("prefers the installation the loader sits in, past a package.json that names no plugin", () => {
    // The loader bundled into an installation (the CLI or desktop bundle): `app/package.json`
    // names the plugin and carries it; `app/dist/package.json` names none and is walked past.
    const app = path.join(scratch, "app");
    const inlined = path.join(app, "dist", "loader.mjs");
    fs.mkdirSync(path.dirname(inlined), { recursive: true });
    fs.copyFileSync(bundle, inlined);
    fs.writeFileSync(path.join(app, "dist", "package.json"), JSON.stringify({ type: "module" }));
    fs.writeFileSync(
      path.join(app, "package.json"),
      JSON.stringify({ name: "app", dependencies: { "@penguinharness/goal": "*" } }),
    );
    GOAL_PLUGIN(path.join(app, "node_modules", "@penguinharness", "goal"));
    // The program's installation is a host too, of a different plugin: were it chosen, the
    // library would read that one instead.
    const other = path.join(scratch, "other");
    HUMANIZER_PLUGIN(path.join(other, "node_modules", "@penguinharness", "humanizer"));
    fs.writeFileSync(
      path.join(other, "package.json"),
      JSON.stringify({ name: "other", dependencies: { "@penguinharness/humanizer": "*" } }),
    );
    const program = path.join(other, "serve.mjs");
    fs.writeFileSync(program, script(inlined));
    expect(run(program)).toEqual({ loaded: true, names: ["goal"] });
  });

  it("prefers the library a push carried over the one installed beside the program", () => {
    // The same old installation as above — it only ever had `goal` — and a push whose assets
    // carry a newer library laid out as a host package (scripts/library-payload.mjs).
    const lib = path.join(scratch, "install", "lib");
    const pushed = path.join(scratch, "root", "hmr", "assets", ".unpacked", "library");
    fs.mkdirSync(pushed, { recursive: true });
    fs.writeFileSync(
      path.join(pushed, "package.json"),
      JSON.stringify({
        name: "penguin-plugin-library",
        dependencies: { "@penguinharness/goal": "*", "@penguinharness/humanizer": "*" },
      }),
    );
    GOAL_PLUGIN(path.join(pushed, "node_modules", "@penguinharness", "goal"));
    HUMANIZER_PLUGIN(path.join(pushed, "node_modules", "@penguinharness", "humanizer"));
    const program = path.join(lib, "dist", "serve-pushed.mjs");
    fs.writeFileSync(
      program,
      `
import { loadLibraryPlugins, usePushedPluginLibrary } from ${JSON.stringify(pathToFileURL(bundle).href)};
const names = () => loadLibraryPlugins().map((p) => p.name).sort();
const before = names();
usePushedPluginLibrary(${JSON.stringify(pushed)});
const carried = names();
usePushedPluginLibrary(null);
console.log(JSON.stringify({ loaded: true, names: [before.join(","), carried.join(","), names().join(",")] }));
`,
    );
    // The program's own library, then the pushed one, then back again once it is unset.
    expect(run(program)).toEqual({ loaded: true, names: ["goal", "goal,humanizer", "goal"] });
  });

  it("reads the host an embedder named over the one installed beside the program, and a push over both", () => {
    // The server names its own package; here an embedder names one holding only humanizer,
    // while the program's installation (above) holds goal.
    const named = path.join(scratch, "named");
    fs.mkdirSync(named, { recursive: true });
    fs.writeFileSync(
      path.join(named, "package.json"),
      JSON.stringify({ name: "embedder", dependencies: { "@penguinharness/humanizer": "*" } }),
    );
    HUMANIZER_PLUGIN(path.join(named, "node_modules", "@penguinharness", "humanizer"));
    const pushed = path.join(scratch, "root", "hmr", "assets", ".unpacked", "library");
    const program = path.join(scratch, "install", "lib", "dist", "serve-named.mjs");
    fs.writeFileSync(
      program,
      `
import { loadLibraryPlugins, useLibraryHost, usePushedPluginLibrary } from ${JSON.stringify(pathToFileURL(bundle).href)};
const names = () => loadLibraryPlugins().map((p) => p.name).sort().join(",");
useLibraryHost(${JSON.stringify(named)});
const own = names();
usePushedPluginLibrary(${JSON.stringify(pushed)});
const carried = names();
console.log(JSON.stringify({ loaded: true, names: [own, carried] }));
`,
    );
    expect(run(program)).toEqual({ loaded: true, names: ["humanizer", "goal,humanizer"] });
  });
});
