/**
 * The plugin library's host package, where a pushed platform lives (plugins/index.ts).
 *
 * Two fixed starting points, each walked upward to the first package.json naming a plugin
 * package: the installation the loader sits in, then the installation of the running program
 * (`process.argv[1]`). A hot-pushed platform bundle sits in a data root's store, where nothing
 * above it is a package, so the loader must not look at import, and its plugins are the ones
 * installed with the program that booted it. Pinned by bundling the loader into a
 * package-less scratch directory and running node against it, the way the far side of a push
 * does.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const LOADER = path.resolve(import.meta.dirname, "../src/plugins/index.ts");
const GOAL_PLUGIN = path.resolve(import.meta.dirname, "../../../plugins/goal");
const HUMANIZER_PLUGIN = path.resolve(import.meta.dirname, "../../../plugins/humanizer");

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
    await build({
      entryPoints: [LOADER],
      bundle: true,
      platform: "node",
      format: "esm",
      target: "node24",
      outfile: bundle,
      logLevel: "silent",
    });
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
    fs.cpSync(GOAL_PLUGIN, path.join(lib, "node_modules", "@penguinharness", "goal"), {
      recursive: true,
    });
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
    fs.cpSync(GOAL_PLUGIN, path.join(app, "node_modules", "@penguinharness", "goal"), {
      recursive: true,
    });
    // The program's installation is a host too, of a different plugin: were it chosen, the
    // library would read that one instead.
    const other = path.join(scratch, "other");
    fs.cpSync(HUMANIZER_PLUGIN, path.join(other, "node_modules", "@penguinharness", "humanizer"), {
      recursive: true,
    });
    fs.writeFileSync(
      path.join(other, "package.json"),
      JSON.stringify({ name: "other", dependencies: { "@penguinharness/humanizer": "*" } }),
    );
    const program = path.join(other, "serve.mjs");
    fs.writeFileSync(program, script(inlined));
    expect(run(program)).toEqual({ loaded: true, names: ["goal"] });
  });
});
