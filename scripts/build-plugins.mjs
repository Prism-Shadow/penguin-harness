/**
 * The builtin plugins, shipped as the npm packages they are: every `plugins/*` package with
 * a code entry is built by its own `build` script, packed by `pnpm pack` — exactly what
 * `npm publish` would send — and installed by npm into a staging directory laid out as an npm
 * prefix (`<out>/package.json` + `<out>/node_modules/<name>/…`, dependencies included). That
 * prefix is the one shape both consumers resolve from: the hot push ships it under `plugins/`
 * in its assets, the desktop build stages it beside `skills/`.
 *
 * Nothing about a package is rewritten. Its `package.json`, its `exports`, its `dist/` and its
 * `README.md` reach the target as the package's own build produced them; a dependency it
 * declares is installed beside it the way npm installs it anywhere. The SDK's runtime is not
 * among those dependencies — a plugin compiles against `@prismshadow/penguin-core`'s types
 * (a devDependency) and shares the host's copy at run time.
 *
 * A builtin plugin bundles what it runs. Every file in the prefix is a blob a push carries
 * separately, so an npm dependency tree (a grammar collection, a web framework's CJS, ESM and
 * type copies) turns one plugin into hundreds of small transfers. Its own build compiles its
 * pure-JS dependencies into `dist/`; what remains a runtime dependency is a native module whose
 * per-platform binaries cannot live inside a bundle, named in NATIVE_DEPENDENCIES — and a
 * package declaring anything else fails this build before anything is packed.
 *
 * What npm installs for those dependencies is what pnpm-lock.yaml resolves, nothing newer: the
 * prefix's manifest pins their whole locked closure as `overrides`, and a tree that differs from
 * the lockfile by version or by tarball integrity fails the build (scripts/lib/locked-prefix.mjs).
 * The licenses of those third-party packages ship beside them as `THIRD-PARTY-NOTICES.md` at the
 * prefix's root (scripts/lib/third-party-notices.mjs); a package without license text fails it.
 *
 * THE BUILTIN INDEX IS THE BUILD'S. Every package the prefix ships is also laid out as a
 * store entry — `<name>/<version>/<hash16>/manifest.toml + package/`, the
 * shape of a machine's plugin store and of the index repository (scripts/plugin-entry.mjs) —
 * in a tree beside the prefix, and `index.json` is rebuilt from that tree into the prefix. So
 * the index travels with the build, each entry's `integrity` is the one a machine computes
 * when it stores the shipped package, and nobody writes it by hand.
 *
 * Cached by content: the hash over every plugin's `src/`, `package.json`, `README.md` and
 * `tsup.config.ts`, and over the lockfile entries the prefix is pinned to, names a directory
 * under `node_modules/.cache/penguin-plugins/`, and an unchanged set is not built, packed or
 * installed again — a push of an unrelated change costs nothing here. Installing needs the registry (for the dependencies) the first time only.
 *
 * THE INDEX'S INTEGRITY IS THE PUBLISHED TARBALL'S. Each plugin is packed once; the tarball is
 * kept beside the prefix in the cache, its npm integrity (sha512 of its bytes, what the registry
 * reports as `dist.integrity`) is the one the index names, and the release publishes that very
 * file (`--tarballs`) rather than letting a publish command pack again — two packers pick the
 * same files and still write different bytes.
 *
 * Usage (a library for deploy.mjs / desktop build-assets.mjs, and a CLI):
 *   node scripts/build-plugins.mjs --out <dir>         stage the prefix into <dir>
 *   node scripts/build-plugins.mjs --tarballs <dir>    copy the packed tarballs into <dir>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  integrityMismatches,
  lockCacheInput,
  lockedClosure,
  platformSpecs,
  readPnpmLock,
} from "./lib/locked-prefix.mjs";
import { readVendoredPackages, thirdPartyNotices } from "./lib/third-party-notices.mjs";
import { INDEX_FILE, layOutEntry, entryDir, sortIndex, tarballIntegrity } from "./plugin-entry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_SRC = path.join(ROOT, "plugins");
const CACHE = path.join(ROOT, "node_modules", ".cache", "penguin-plugins");
const COMPLETE = ".complete";
/** Folded into the cache key: bump when what this script WRITES changes, not only what it reads. */
const PACK_FORMAT = 15;
// The server's own dependency: the store writes its manifests with the same library.
const { stringify: stringifyToml } = createRequire(
  path.join(ROOT, "packages", "server", "package.json"),
)("smol-toml");
/** The prefix's own manifest: npm needs one above `node_modules`, and it is ours, never a package's. */
const PREFIX_MANIFEST = { name: "penguin-builtin-plugins", private: true, version: "0.0.0" };
/**
 * The runtime dependencies a builtin plugin may declare: native modules only, each with a
 * reason. Everything else is compiled into the plugin's `dist/` by its own build.
 */
const NATIVE_DEPENDENCIES = new Map([
  ["koffi", "FFI with per-platform prebuilt binaries (sandbox-dsh's Windows ACL runner)"],
  [
    "@deepseek-ai/dsh-sandbox-local",
    "picks its per-platform rung by bare specifier at run time — bundling it makes the Windows one unresolvable (sandbox-dsh)",
  ],
  ["@deepseek-ai/cordis", "the context the DSH chain is mounted on, shared with it (sandbox-dsh)"],
  [
    "@deepseek-ai/node-addon-landlock-run",
    "resolves its per-platform launcher binary package at run time (sandbox-dsh)",
  ],
]);

/**
 * The hosts a pushed prefix may land on. npm installs a native module's binary for the machine
 * doing the install, and this build runs wherever CI or a developer happens to be — so a prefix
 * built on Linux carried no Windows binary, and sandbox-dsh's Windows runner failed there with
 * "Cannot find the native Koffi module". The per-platform packages of every NATIVE_DEPENDENCIES
 * entry are installed for each of these as well; they are small next to the plugins themselves,
 * and one prefix then serves every target a push can reach.
 */
const TARGET_PLATFORMS = [
  { os: "linux", cpu: "x64" },
  { os: "linux", cpu: "arm64" },
  { os: "win32", cpu: "x64" },
  { os: "darwin", cpu: "arm64" },
];

/** The third-party license notices written at the prefix's root, beside its manifest. */
const NOTICES_FILE = "THIRD-PARTY-NOTICES.md";

/** What npm leaves in the prefix that is not a package: its hidden lockfile. Never shipped. */
const NOT_SHIPPED = new Set(["node_modules/.package-lock.json"]);

/** Files under `dir`, as sorted relative posix paths (symlinks — `.bin` shims — excluded). */
async function walk(dir, prefix = "") {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

/** A package manager's command, as the platform names it. */
function command(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}
// cmd.exe does not unquote spawn args by itself: under `shell: true` the args are joined
// into one command line, so a path with a space (the pack directory lives under the user's
// temp directory, i.e. their profile) splits into two. Quoted the way run-with-env.mjs quotes.
const quote = (a) => (/[\s"^&|<>;,()%!]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a);
function run(name, args, cwd) {
  const windows = process.platform === "win32";
  try {
    execFileSync(command(name), windows ? args.map(quote) : args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: windows,
      env: process.env,
    });
  } catch (err) {
    const stderr = err instanceof Object && "stderr" in err ? String(err.stderr).trim() : "";
    throw new Error(`${name} ${args.slice(0, 3).join(" ")} failed in ${cwd}\n${stderr}`);
  }
}

/**
 * What a plugin's pack depends on: its sources, its manifest, its README, its build config —
 * and every other directory the package SHIPS.
 *
 * That last part is not decoration. A plugin may carry files its code never imports (the Windows
 * backend ships the PowerShell script its setup runs), and hashing only `src/` meant editing one
 * of them changed nothing the cache could see: the build happily served a stale pack, and the
 * fix nobody could find on the host was a file that had never left this machine.
 */
async function sourceHash(dir, into) {
  for (const rel of ["package.json", "README.md", "tsup.config.ts"]) {
    const file = path.join(dir, rel);
    if (fs.existsSync(file))
      into
        .update(rel)
        .update("\0")
        .update(await fsp.readFile(file))
        .update("\0");
  }
  const manifest = JSON.parse(await fsp.readFile(path.join(dir, "package.json"), "utf8"));
  // `dist` and `vendor` are built or fetched from what is hashed here, never edited by hand.
  const shipped = (manifest.files ?? []).filter((f) => !["dist", "vendor"].includes(f));
  for (const name of ["src", ...shipped]) {
    const sub = path.join(dir, name);
    if (!fs.existsSync(sub) || !fs.statSync(sub).isDirectory()) continue;
    for (const rel of await walk(sub)) {
      into
        .update(`${name}/${rel}`)
        .update("\0")
        .update(await fsp.readFile(path.join(sub, rel)))
        .update("\0");
    }
  }
}

/** Every plugin package under `plugins/`: a package.json that declares `penguin`. */
async function pluginPackages() {
  const out = [];
  const entries = fs.existsSync(PLUGINS_SRC) ? await fsp.readdir(PLUGINS_SRC) : [];
  for (const dirName of entries.sort()) {
    const dir = path.join(PLUGINS_SRC, dirName);
    const manifestFile = path.join(dir, "package.json");
    if (!fs.existsSync(manifestFile)) continue;
    const pkg = JSON.parse(await fsp.readFile(manifestFile, "utf8"));
    // A package with a code entry is built and packed; one without (skills, hooks) carries no code.
    if (pkg.main === undefined && pkg.exports === undefined) continue;
    const unbundled = Object.keys(pkg.dependencies ?? {}).filter(
      (d) => !NATIVE_DEPENDENCIES.has(d),
    );
    if (unbundled.length > 0) {
      throw new Error(
        `${pkg.name} declares runtime dependencies ${unbundled.join(", ")}: a builtin plugin bundles ` +
          "what it runs (tsup noExternal, the package a devDependency) — every file it would " +
          "install is a separate blob on every push. Only native modules stay dependencies " +
          "(NATIVE_DEPENDENCIES in scripts/build-plugins.mjs).",
      );
    }
    out.push({ name: pkg.name, version: pkg.version, dir });
  }
  return out;
}

/**
 * Builds, packs and installs every builtin plugin into one staged prefix (from cache when
 * nothing changed) and returns `{ dir, files, plugins }`: the prefix directory, the relative
 * paths to ship, and `[{ name, version }]` of what it holds.
 */
export async function buildBuiltinPlugins({ log = () => {} } = {}) {
  const plugins = await pluginPackages();
  // A native module publishes one package per `<os>-<cpu>` (koffi: `@koromix/koffi-win32-x64`)
  // and depends on all of them optionally; the lockfile names them, so the closure holds the
  // ones for TARGET_PLATFORMS and this build never hardcodes a platform triple.
  const lock = readPnpmLock(ROOT);
  const importers = plugins.map((p) => path.relative(ROOT, p.dir).split(path.sep).join("/"));
  const closure = lockedClosure(lock, importers, NATIVE_DEPENDENCIES, TARGET_PLATFORMS);
  const builtinNames = new Set(plugins.map((p) => p.name));
  const h = createHash("sha256").update(`pack ${PACK_FORMAT}\0`);
  h.update(lockCacheInput(lock, closure)).update("\0");
  for (const plugin of plugins) {
    h.update(plugin.name).update("\0");
    await sourceHash(plugin.dir, h);
  }
  const hash = h.digest("hex").slice(0, 16);
  const out = path.join(CACHE, hash);
  if (fs.existsSync(path.join(out, COMPLETE))) {
    log(`${plugins.length} builtin plugins: cached (${hash})`);
  } else {
    await fsp.rm(out, { recursive: true, force: true });
    await fsp.mkdir(out, { recursive: true });
    const packed = tarballsOf(out);
    await fsp.rm(packed, { recursive: true, force: true });
    await fsp.mkdir(packed, { recursive: true });
    try {
      const tarballs = [];
      for (const plugin of plugins) {
        // The package's own build, then the package as npm would publish it (`files` honored,
        // `workspace:` ranges rewritten) — nothing this script decides.
        run("pnpm", ["--filter", plugin.name, "run", "build"], ROOT);
        run("pnpm", ["pack", "--pack-destination", packed], plugin.dir);
        const tarball = (await fsp.readdir(packed)).find(
          (f) => f.endsWith(".tgz") && !tarballs.some((t) => path.basename(t) === f),
        );
        if (tarball === undefined) throw new Error(`pnpm pack left no tarball for ${plugin.name}`);
        tarballs.push(path.join(packed, tarball));
        log(`plugin ${plugin.name}@${plugin.version}: packed`);
      }
      // The manifest names what is shipped — how the loader tells the plugins from what npm
      // installs beside them — and --no-save below keeps npm from rewriting it.
      // `overrides` pins every package of the native closure, transitive ones included, to the
      // version pnpm-lock.yaml resolves; without it npm resolves each `^` range afresh.
      const dependencies = Object.fromEntries(plugins.map((p) => [p.name, p.version]));
      const overrides = Object.fromEntries(closure);
      await fsp.writeFile(
        path.join(out, "package.json"),
        `${JSON.stringify({ ...PREFIX_MANIFEST, dependencies, overrides }, null, 2)}\n`,
      );
      if (tarballs.length > 0) {
        // npm installs the packages and their dependencies into the prefix; --no-save keeps
        // the prefix's manifest ours (no `file:` paths into a temp directory), --omit=dev
        // leaves the SDK's types and the build tools behind.
        run(
          "npm",
          [
            "install",
            "--no-save",
            "--no-package-lock",
            "--omit=dev",
            "--no-audit",
            "--no-fund",
            "--ignore-scripts",
            "--",
            ...tarballs,
          ],
          out,
        );
        // One call for every target: npm reconciles the tree on each install, so a second
        // install would prune the first target's package as extraneous. --force is what makes
        // npm accept a package whose `os`/`cpu` is not this machine's — the point of the call.
        const platformPackages = platformSpecs(lock, closure);
        if (platformPackages.length > 0) {
          run(
            "npm",
            [
              "install",
              "--no-save",
              "--no-package-lock",
              "--omit=dev",
              "--no-audit",
              "--no-fund",
              "--ignore-scripts",
              "--force",
              "--",
              ...platformPackages,
            ],
            out,
          );
        }
        if (platformPackages.length > 0) {
          log(`${platformPackages.length} per-platform native binaries: installed`);
        }
        const npmLock = JSON.parse(
          await fsp.readFile(path.join(out, "node_modules", ".package-lock.json"), "utf8"),
        );
        const drift = integrityMismatches(lock, closure, npmLock, builtinNames);
        if (drift.length > 0) {
          throw new Error(
            `npm's tree in the builtin prefix differs from pnpm-lock.yaml:\n  ${drift.join("\n  ")}`,
          );
        }
        const thirdParty = readVendoredPackages(path.join(out, "node_modules")).filter(
          (p) => !builtinNames.has(p.name),
        );
        if (thirdParty.length > 0) {
          const notices = thirdPartyNotices(thirdParty, {
            carrier: PREFIX_MANIFEST.name,
            location: "node_modules/",
          });
          await fsp.writeFile(path.join(out, NOTICES_FILE), notices);
        }
        log(`${closure.size} locked third-party packages: verified`);
      }
      // npm installs a package's files with the mode it pleases, and a vendored program
      // arrives without its exec bit — which no consumer of the prefix can guess back.
      for (const rel of await walk(out)) {
        if (/(^|\/)vendor\/[^/]+\/bin\/[^/]+$/.test(rel)) {
          await fsp.chmod(path.join(out, rel), 0o755);
        }
      }
      const index = await layOutTree(out, treeOf(out), plugins, await packedIntegrities(packed));
      await fsp.writeFile(path.join(out, INDEX_FILE), `${JSON.stringify(index, null, 2)}\n`);
      log(`${index.length} index entries: rebuilt from the tree`);
      await fsp.writeFile(path.join(out, COMPLETE), hash);
      log(`${plugins.length} builtin plugins: installed (${hash})`);
    } catch (err) {
      await fsp.rm(out, { recursive: true, force: true });
      await fsp.rm(treeOf(out), { recursive: true, force: true });
      await fsp.rm(packed, { recursive: true, force: true });
      throw err;
    }
  }
  const files = (await walk(out)).filter((f) => f !== COMPLETE && !NOT_SHIPPED.has(f));
  return {
    dir: out,
    files,
    plugins: plugins.map(({ name, version }) => ({ name, version })),
    tree: treeOf(out),
    tarballs: tarballsOf(out),
  };
}

/** Where a prefix's packed tarballs are kept: beside it in the cache, never shipped. */
function tarballsOf(prefix) {
  return `${prefix}.tarballs`;
}

/** Each packed tarball's npm integrity, by the package name its own manifest gives. */
async function packedIntegrities(dir) {
  const out = new Map();
  for (const file of (await fsp.readdir(dir)).filter((f) => f.endsWith(".tgz")).sort()) {
    const abs = path.join(dir, file);
    // Run in the tarball's directory and name it bare: GNU tar (Git Bash on Windows) reads the
    // `D:` of an absolute Windows path as a remote host.
    const manifest = JSON.parse(
      execFileSync("tar", ["-xzOf", file, "package/package.json"], { encoding: "utf8", cwd: dir }),
    );
    out.set(manifest.name, await tarballIntegrity(abs));
  }
  return out;
}

/** The store-shaped tree of a prefix: beside it in the cache, never shipped. */
function treeOf(prefix) {
  return `${prefix}.tree`;
}

/**
 * Lays every plugin the prefix ships out as a store entry under `tree` — the same module a
 * machine's store writes its entries with — and answers the index rebuilt from the tree:
 * each entry's `manifest.toml`, sorted as every index is.
 */
async function layOutTree(prefix, tree, plugins, integrities) {
  await fsp.rm(tree, { recursive: true, force: true });
  const stage = path.join(tree, ".staging");
  const index = [];
  for (const plugin of plugins) {
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.mkdir(stage, { recursive: true });
    const pkgDir = path.join(prefix, "node_modules", ...plugin.name.split("/"));
    const integrity = integrities.get(plugin.name);
    if (integrity === undefined)
      throw new Error(`${plugin.name}: no packed tarball to take its integrity from`);
    const laid = await layOutEntry(stage, pkgDir, prefix, { stringifyToml, integrity });
    const dest = entryDir(tree, laid.name, laid.version, laid.integrity);
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.rename(stage, dest);
    index.push(laid.manifest);
  }
  await fsp.rm(stage, { recursive: true, force: true });
  const rebuilt = sortIndex(index);
  await fsp.writeFile(path.join(tree, INDEX_FILE), `${JSON.stringify(rebuilt, null, 2)}\n`);
  return rebuilt;
}

/** The prefix as a file map, relative to the prefix, each value an absolute source path. */
export function prefixLayout(built) {
  return new Map(built.files.map((rel) => [rel, { path: path.join(built.dir, rel) }]));
}

/** Writes the prefix into `dest`, replacing what was there. */
export async function stagePrefix(built, dest) {
  await fsp.rm(dest, { recursive: true, force: true });
  for (const [rel, source] of prefixLayout(built)) {
    const target = path.join(dest, ...rel.split("/"));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await fsp.copyFile(source.path, target);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx === -1 ? null : process.argv[outIdx + 1];
  const tarIdx = process.argv.indexOf("--tarballs");
  const tarDest = tarIdx === -1 ? null : process.argv[tarIdx + 1];
  const built = await buildBuiltinPlugins({ log: (m) => console.log(`[build-plugins] ${m}`) });
  if (tarDest) {
    const dest = path.resolve(tarDest);
    await fsp.rm(dest, { recursive: true, force: true });
    await fsp.mkdir(dest, { recursive: true });
    const files = (await fsp.readdir(built.tarballs)).filter((f) => f.endsWith(".tgz"));
    for (const f of files) await fsp.copyFile(path.join(built.tarballs, f), path.join(dest, f));
    console.log(`[build-plugins] copied ${files.length} packed tarballs into ${dest}`);
  }
  if (out) {
    await stagePrefix(built, path.resolve(out));
    console.log(
      `[build-plugins] staged ${built.plugins.length} plugins (${built.files.length} files) into ${path.resolve(out)}`,
    );
  }
}
