#!/usr/bin/env node
/**
 * The plugins the release publishes with code in them, packed and installed the way a user's
 * `npm install` receives them — and loaded from there.
 *
 * `pnpm pack` is what `pnpm publish` uploads, and it is not the directory: it keeps only what
 * `files` names, drops symlinks, and marks nothing executable beyond `bin` and
 * `publishConfig.executableFiles`. While the sandbox backends were private nobody packed them,
 * and two of those rules went unseen: the vendored bwrap arrived without its exec bit, and
 * without the `libcap.so.2` link it loads. An npm install then ran the host's bwrap, or none.
 *
 * Checked for every non-private plugin with a code entry (`main`), after the workspace is built:
 *   - every `files` entry is in the tarball (LICENSE staged first, the way the release stages it);
 *   - every vendored `vendor/<target>/bin/<program>` is executable in the tarball, and bwrap's
 *     `lib/libcap.so.2` is a regular file beside it.
 * Then the tarballs are installed into a scratch npm prefix, with the workspace's core linked in
 * as the host that provides it at run time, and loaded:
 *   - sandbox-bwrap (Linux): `vendoredRunner()` finds the shipped binary, it runs, and the
 *     loader takes libcap from the vendored `lib/`, not the host's;
 *   - sandbox-dsh: `loadDshAdaptor()` resolves, and its native modules load from the install.
 *
 * Usage: node scripts/check-plugin-packs.mjs   (after `pnpm -r build`)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "..");
const tar = createRequire(path.join(root, "packages", "server", "package.json"))("tar");
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const run = (command, args, cwd) =>
  execFileSync(command, args, {
    cwd,
    stdio: ["ignore", "ignore", "inherit"],
    shell: process.platform === "win32",
  });

const failures = [];
const fail = (message) => failures.push(message);

const plugins = fs
  .readdirSync(path.join(root, "plugins"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(root, "plugins", entry.name))
  .filter((dir) => fs.existsSync(path.join(dir, "package.json")))
  .map((dir) => ({ dir, pkg: read(path.join(dir, "package.json")) }))
  .filter(({ pkg }) => pkg.private !== true && typeof pkg.main === "string");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "penguin-plugin-packs-"));
const staged = [];
try {
  const tarballs = new Map();
  for (const { dir, pkg } of plugins) {
    const license = path.join(dir, "LICENSE");
    if (!fs.existsSync(license)) {
      fs.copyFileSync(path.join(root, "LICENSE"), license);
      staged.push(license);
    }
    const out = path.join(scratch, "packs", path.basename(dir));
    fs.mkdirSync(out, { recursive: true });
    run("pnpm", ["pack", "--pack-destination", out], dir);
    const file = path.join(
      out,
      fs.readdirSync(out).find((f) => f.endsWith(".tgz")),
    );
    tarballs.set(pkg.name, file);

    const entries = new Map();
    await tar.t({
      file,
      onReadEntry: (e) => entries.set(e.path.replace(/^package\//, ""), e),
    });
    for (const want of pkg.files ?? []) {
      if (![...entries.keys()].some((rel) => rel === want || rel.startsWith(`${want}/`))) {
        fail(`${pkg.name}: the tarball has no ${want}`);
      }
    }
    for (const [rel, e] of entries) {
      const vendored = /^vendor\/([^/]+)\/bin\/([^/]+)$/.exec(rel);
      if (vendored === null) continue;
      if ((e.mode & 0o111) === 0) {
        fail(`${pkg.name}: ${rel} is not executable in the tarball (mode ${e.mode.toString(8)})`);
      }
      const lib = `vendor/${vendored[1]}/lib/libcap.so.2`;
      if (vendored[2] === "bwrap" && entries.get(lib)?.type !== "File") {
        fail(`${pkg.name}: the tarball has no ${lib} for ${rel} to load`);
      }
    }
    console.log(`${pkg.name}: packed, ${entries.size} files`);
  }

  const prefix = path.join(scratch, "prefix");
  fs.mkdirSync(prefix);
  fs.writeFileSync(
    path.join(prefix, "package.json"),
    '{ "name": "plugin-packs", "private": true }',
  );
  if (tarballs.size > 0) {
    run(
      "npm",
      [
        "install",
        "--no-save",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "--",
        ...tarballs.values(),
      ],
      prefix,
    );
  }
  // A plugin compiles against core and shares the host's copy at run time.
  const core = path.join(prefix, "node_modules", "@prismshadow", "penguin-core");
  fs.mkdirSync(path.dirname(core), { recursive: true });
  fs.symlinkSync(path.join(root, "packages", "core"), core, "junction");

  const installed = (name) => path.join(prefix, "node_modules", ...name.split("/"));
  const load = (name) =>
    import(
      pathToFileURL(
        path.join(installed(name), read(path.join(installed(name), "package.json")).main),
      ).href
    );

  if (tarballs.has("@penguinharness/sandbox-bwrap") && process.platform === "linux") {
    const { vendoredRunner } = await load("@penguinharness/sandbox-bwrap");
    const runner = vendoredRunner();
    if (runner === "") {
      fail(
        `@penguinharness/sandbox-bwrap: no executable vendored bwrap for linux-${process.arch} after npm install`,
      );
    } else {
      // glibc's loader reports every library it initializes; the vendored one must be the libcap.
      const r = spawnSync(runner, ["--version"], {
        encoding: "utf8",
        env: { ...process.env, LD_DEBUG: "libs" },
      });
      const libcap = /calling init: (\S*libcap\.so\.2)\s*$/m.exec(r.stderr ?? "")?.[1];
      if (r.status !== 0) {
        fail(
          `@penguinharness/sandbox-bwrap: ${runner} --version exited ${r.status}: ${r.stderr.trim().split("\n").at(-1)}`,
        );
      } else if (
        libcap !== undefined &&
        !libcap.startsWith(path.join(installed("@penguinharness/sandbox-bwrap"), "vendor"))
      ) {
        fail(
          `@penguinharness/sandbox-bwrap: the vendored bwrap loaded the host's ${libcap}, not its own`,
        );
      } else {
        console.log(
          `@penguinharness/sandbox-bwrap: ${r.stdout.trim()} from the install, libcap ${libcap ?? "(loader did not report)"}`,
        );
      }
    }
  }

  if (tarballs.has("@penguinharness/sandbox-dsh")) {
    const name = "@penguinharness/sandbox-dsh";
    const { loadDshAdaptor } = await load(name);
    const from = createRequire(path.join(installed(name), "package.json"));
    const say = (err) => (err instanceof Error ? err.message : String(err));
    try {
      const provider = await loadDshAdaptor();
      console.log(`${name}: the DSH chain loads (${provider?.dimensions.join(", ")})`);
    } catch (err) {
      fail(`${name}: loadDshAdaptor() failed after npm install: ${say(err)}`);
    }
    // The two native pieces, as the chain resolves them from this package: koffi's per-platform
    // binary (npm 11 does not run its install script), and Landlock's prebuilt launcher.
    try {
      from("koffi");
      console.log(`${name}: koffi loads`);
    } catch (err) {
      fail(`${name}: koffi does not load after npm install: ${say(err)}`);
    }
    if (process.platform === "linux") {
      try {
        const landlock = await import(
          pathToFileURL(from.resolve("@deepseek-ai/node-addon-landlock-run")).href
        );
        const launcher = landlock.launcherPath();
        // What the kernel enforces is the host's business: the verdict is reported, not asserted.
        console.log(`${name}: landlock-run resolves, probe ${landlock.probe(launcher)}`);
      } catch (err) {
        fail(`${name}: the Landlock launcher does not resolve after npm install: ${say(err)}`);
      }
    }
  }
} finally {
  for (const file of staged) fs.rmSync(file, { force: true });
  fs.rmSync(scratch, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error(`plugin packs: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`plugin packs: ${plugins.length} packed, installed and loaded`);
