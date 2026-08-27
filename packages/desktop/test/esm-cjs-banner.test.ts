/**
 * The CJS-globals banner every ESM bundle in this repo carries (scripts/esm-cjs-banner.mjs).
 *
 * Bundling third-party CommonJS into an ESM file drops the module wrapper that supplied
 * `require`, `__filename` and `__dirname`, so each reference an absorbed dependency makes
 * has to find a declaration in the bundle's own top-level scope. The banner shipped only
 * `require` once, and `@larksuiteoapi/node-sdk`'s `__dirname` then failed the desktop app's
 * Feishu binding with `__dirname is not defined`. These tests pin all three: the banner's
 * own values, a real esbuild round-trip through a CJS dependency that reads them, the
 * redeclaration a bundled ESM module brings with it, and both bundling sites sourcing the
 * one banner rather than re-inlining a partial copy.
 *
 * Every module here is evaluated in a CHILD `node` process. Vitest runs test modules through
 * Vite's SSR runner, whose wrapper defines `__filename` and `__dirname` itself — importing
 * these fixtures in-process passes whether or not the banner declares anything, which is
 * exactly the failure being guarded against.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { ESM_CJS_BANNER } from "../../../scripts/esm-cjs-banner.mjs";

/** The banner as it shipped in 0.2.6 — `require` alone, which is how `__dirname` slipped through. */
const REQUIRE_ONLY_BANNER =
  'import { createRequire as __penguinCreateRequire } from "node:module"; const require = __penguinCreateRequire(import.meta.url);';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

// Every path asserted below is compared against one Node reported, and Node resolves a module's
// real path before evaluating it — so the root they all derive from has to be a real one too.
// macOS gets there on its own, where os.tmpdir() is a /var/... symlink onto /private/var/...;
// reaching the root through a symlink of our own has every platform run that same resolution,
// so dropping the realpathSync fails here rather than on one runner only. `fs.realpathSync`
// and not its `.native` variant: that is the one the ESM loader uses, and the two disagree
// about Windows 8.3 short paths.
const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-esm-cjs-banner-"));
const tmpLink = `${tmpTarget}-link`;
fs.symlinkSync(tmpTarget, tmpLink, "junction");
const tmp = fs.realpathSync(tmpLink);
afterAll(() => {
  fs.rmSync(tmpLink, { recursive: true, force: true });
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Imports `moduleFile` in a real Node process and returns its `probe` export. */
function probeInNode(moduleFile: string): Record<string, unknown> {
  const runner = path.join(path.dirname(moduleFile), "run.mjs");
  fs.writeFileSync(
    runner,
    `const m = await import(${JSON.stringify(pathToFileURL(moduleFile).href)});\n` +
      `process.stdout.write(JSON.stringify(m.probe));\n`,
  );
  let stdout: string;
  try {
    // stderr is captured rather than inherited: one case below fails the child on purpose.
    stdout = execFileSync(process.execPath, [runner], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new Error(String((err as { stderr?: string }).stderr ?? (err as Error).message));
  }
  return JSON.parse(stdout);
}

/** A directory holding one fixture, so each case gets its own `run.mjs`. */
function caseDir(name: string): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Bundles `entry` to `outfile` the way both build sites do: ESM, node, banner attached. */
async function bundleWithBanner(entry: string, outfile: string): Promise<void> {
  const esbuild = await import("esbuild");
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
    logLevel: "silent",
    banner: { js: ESM_CJS_BANNER },
  });
}

describe("ESM_CJS_BANNER", () => {
  it("declares require, __filename and __dirname with the values CJS would have given", () => {
    const file = path.join(caseDir("values"), "probe.mjs");
    fs.writeFileSync(
      file,
      `${ESM_CJS_BANNER}\nexport const probe = { requireType: typeof require, sep: require("node:path").sep, filename: __filename, dirname: __dirname };\n`,
    );
    const probe = probeInNode(file);
    expect(probe.requireType).toBe("function");
    expect(probe.sep).toBe(path.sep);
    // Exactly CJS's spelling: the file itself, and its directory with no trailing separator.
    expect(probe.filename).toBe(file);
    expect(probe.dirname).toBe(path.dirname(file));
  });

  it("is what makes the difference — the require-only banner still throws", () => {
    const file = path.join(caseDir("require-only"), "probe.mjs");
    fs.writeFileSync(
      file,
      `${REQUIRE_ONLY_BANNER}\nexport const probe = { dirname: __dirname };\n`,
    );
    // Proves the harness can see the failure at all: without a child process, Vite's runner
    // supplies both globals and this case passes as readily as the one above.
    expect(() => probeInNode(file)).toThrow(/__dirname is not defined/);
  });

  it("carries a bundled CJS dependency's __dirname / __filename reads through esbuild", async () => {
    const dir = caseDir("bundle");
    // A CommonJS dependency of the shape that broke: it reads the globals its wrapper used
    // to supply, at module scope, unguarded.
    fs.writeFileSync(
      path.join(dir, "dep.cjs"),
      'module.exports = { dir: __dirname, file: __filename, sep: require("node:path").sep };\n',
    );
    fs.writeFileSync(
      path.join(dir, "entry.mjs"),
      'export { default as probe } from "./dep.cjs";\n',
    );

    const outfile = path.join(dir, "out.mjs");
    await bundleWithBanner(path.join(dir, "entry.mjs"), outfile);

    const probe = probeInNode(outfile);
    expect(probe.sep).toBe(path.sep);
    // The documented approximation: a bundled dependency sees the BUNDLE's location, not
    // the directory it was published in. Wrong for locating its own shipped files, but
    // defined — which is the whole difference between a wrong path and a hard crash.
    expect(probe.file).toBe(outfile);
    expect(probe.dir).toBe(dir);
  });

  it("survives a bundled module declaring __filename / __dirname of its own", async () => {
    const dir = caseDir("redeclare");
    // The boilerplate an ESM module writes to get the two names back. esbuild renames a
    // bundled module's own top-level `require` but leaves these two spelled as written, so a
    // `const` banner turns the whole bundle into a SyntaxError at load — a worse failure than
    // the one the banner exists to prevent.
    fs.writeFileSync(
      path.join(dir, "dep.mjs"),
      'import { fileURLToPath } from "node:url";\nimport { dirname } from "node:path";\n' +
        "const __filename = fileURLToPath(import.meta.url);\n" +
        "const __dirname = dirname(__filename);\n" +
        "export const info = { dir: __dirname, file: __filename };\n",
    );
    fs.writeFileSync(path.join(dir, "entry.mjs"), 'export { info as probe } from "./dep.mjs";\n');

    const outfile = path.join(dir, "out.mjs");
    await bundleWithBanner(path.join(dir, "entry.mjs"), outfile);

    const probe = probeInNode(outfile);
    expect(probe.file).toBe(outfile);
    expect(probe.dir).toBe(dir);
  });
});

describe("bundling sites", () => {
  // Both emit ESM while absorbing third-party CommonJS, so both need the same declarations.
  // Sharing one constant is what keeps a fix to one of them from missing the other.
  const sites = ["packages/desktop/tsup.config.ts", "scripts/deploy.mjs"];

  it.each(sites)("%s takes its banner from scripts/esm-cjs-banner.mjs", (site) => {
    const source = fs.readFileSync(path.join(REPO_ROOT, site), "utf8");
    expect(source).toMatch(/import \{ ESM_CJS_BANNER \} from "[^"]*esm-cjs-banner\.mjs"/);
    expect(source).toMatch(/banner:\s*\{\s*js:\s*ESM_CJS_BANNER\s*\}/);
    // A hand-inlined banner is how the two drifted apart in the first place.
    expect(source).not.toMatch(/js:\s*['"`]import \{ createRequire/);
  });
});
