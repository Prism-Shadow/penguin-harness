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
 * The prefix also holds the external built-in plugins (scripts/lib/external-plugins.mjs):
 * `@penguinharness/*` packages published from other repositories, which packages/server pins to
 * one exact version. Each with a code entry is staged from its locked tarball — the bytes whose
 * sha512 pnpm-lock.yaml records, checked before anything is built — and listed in the prefix's
 * manifest beside the `plugins/*` packages, so every consumer of the prefix carries it as built
 * in. It is unpacked rather than handed to npm: it bundles what it runs, as a `plugins/*`
 * package does, and the peer ranges it declares on the harness would have npm install the
 * harness into the prefix.
 *
 * Cached by content: the hash over every plugin's `src/`, `package.json`, `README.md` and
 * `tsup.config.ts`, over the lockfile entries the prefix is pinned to, and over each external
 * plugin's locked integrity, names a directory under `node_modules/.cache/penguin-plugins/`, and
 * an unchanged set is not built, packed, fetched or installed again — a push of an unrelated
 * change costs nothing here. Installing needs the registry (for the dependencies and the
 * external plugins) the first time only; `PENGUIN_PLUGIN_TARBALLS` supplies the external
 * plugins' tarballs to a build without one.
 *
 * Usage (a library for deploy.mjs / desktop build-assets.mjs, and a CLI):
 *   node scripts/build-plugins.mjs --out <dir>      stage the prefix into <dir>
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { externalPins, lockedTarball, unpackPackage } from "./lib/external-plugins.mjs";
import {
  integrityMismatches,
  lockCacheInput,
  lockedClosure,
  platformSpecs,
  readPnpmLock,
} from "./lib/locked-prefix.mjs";
import { run } from "./lib/run-command.mjs";
import { readVendoredPackages, thirdPartyNotices } from "./lib/third-party-notices.mjs";
import { offlineCandidates, stageOfflineArchives } from "./lib/offline-archives.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COMPLETE = ".complete";
/** Folded into the cache key: bump when what this script WRITES changes, not only what it reads. */
const PACK_FORMAT = 15;
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

/**
 * What a plugin's pack depends on: its sources, its manifest (`package.json`, whose `penguin`
 * block its card on the Plugins page reads, with its `icon.<ext>`), its README, its build config —
 * and every other directory the package SHIPS.
 *
 * That last part is not decoration. A plugin may carry files its code never imports (the Windows
 * backend ships the PowerShell script its setup runs), and hashing only `src/` meant editing one
 * of them changed nothing the cache could see: the build happily served a stale pack, and the
 * fix nobody could find on the host was a file that had never left this machine.
 */
async function sourceHash(dir, into) {
  const icons = ["svg", "png", "webp", "avif", "jpg", "jpeg", "gif"].map((ext) => `icon.${ext}`);
  for (const rel of ["package.json", ...icons, "README.md", "tsup.config.ts"]) {
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

/**
 * Every plugin package under `plugins/` with a code entry (`main` or `exports`): the packages of
 * server modules.
 */
async function pluginPackages(root) {
  const out = [];
  const src = path.join(root, "plugins");
  const entries = fs.existsSync(src) ? await fsp.readdir(src) : [];
  for (const dirName of entries.sort()) {
    const dir = path.join(src, dirName);
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
 *
 * `root` is the checkout whose `plugins/`, packages/server pins and pnpm-lock.yaml it reads, and
 * `env` the environment its tools run in and `PENGUIN_PLUGIN_TARBALLS` is read from: this
 * repository and this process's, unless a caller stages another.
 */
export async function buildBuiltinPlugins({ log = () => {}, root = ROOT, env = process.env } = {}) {
  const plugins = await pluginPackages(root);
  // A native module publishes one package per `<os>-<cpu>` (koffi: `@koromix/koffi-win32-x64`)
  // and depends on all of them optionally; the lockfile names them, so the closure holds the
  // ones for TARGET_PLATFORMS and this build never hardcodes a platform triple.
  const lock = readPnpmLock(root);
  const importers = plugins.map((p) => path.relative(root, p.dir).split(path.sep).join("/"));
  const closure = lockedClosure(lock, importers, NATIVE_DEPENDENCIES, TARGET_PLATFORMS);
  const builtinNames = new Set(plugins.map((p) => p.name));
  const externals = externalPins(root, lock);
  for (const { name } of externals) {
    if (builtinNames.has(name)) {
      throw new Error(`${name} is both a plugins/ package and an external pin of packages/server`);
    }
  }
  // Listed in the market but not shipped: carried as offline archives (scripts/lib/offline-archives.mjs).
  const offline = await offlineCandidates({
    pluginsSrc: path.join(root, "plugins"),
    indexFile: path.join(root, "packages", "server", "src", "plugin", "builtin-index.json"),
    shipped: builtinNames,
  });
  const h = createHash("sha256").update(`pack ${PACK_FORMAT}\0`);
  h.update(lockCacheInput(lock, closure)).update("\0");
  for (const plugin of [...plugins, ...offline]) {
    h.update(plugin.name).update("\0");
    await sourceHash(plugin.dir, h);
  }
  // The locked integrity is the external package's whole content.
  for (const { name, version, integrity } of externals) {
    h.update(`external ${name}@${version} ${integrity}\0`);
  }
  const hash = h.digest("hex").slice(0, 16);
  const out = path.join(root, "node_modules", ".cache", "penguin-plugins", hash);
  if (fs.existsSync(path.join(out, COMPLETE))) {
    log(`builtin plugins: cached (${hash})`);
  } else {
    await fsp.rm(out, { recursive: true, force: true });
    await fsp.mkdir(out, { recursive: true });
    const packed = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-plugins-pack-"));
    try {
      // The external packages first, so a tarball no source supplies, one that is not the
      // locked one, or a package that cannot ship fails the build before anything is built.
      // A directory of their own, so the pack loop below never takes one for a plugin's.
      const fetched = path.join(packed, "external");
      await fsp.mkdir(fetched);
      const staged = [];
      for (const [i, pin] of externals.entries()) {
        const { file, source } = await lockedTarball(pin, { into: fetched, env });
        const dir = path.join(fetched, String(i));
        const manifest = await unpackPackage(file, dir);
        // A package without one carries content alone: the library reads it from the hosts'
        // node_modules (scripts/library-payload.mjs), and the prefix holds server modules.
        if (manifest.main === undefined && manifest.exports === undefined) {
          log(`plugin ${pin.name}@${pin.version}: ${source}, no code entry: library only`);
          continue;
        }
        const declared = Object.keys({
          ...manifest.dependencies,
          ...manifest.optionalDependencies,
        });
        if (declared.length > 0) {
          throw new Error(
            `${pin.name}@${pin.version} declares runtime dependencies ${declared.join(", ")}: an ` +
              "external built-in plugin bundles what it runs, since nothing would hold what npm " +
              "installed beside it to pnpm-lock.yaml",
          );
        }
        staged.push({ pin, dir });
        log(`plugin ${pin.name}@${pin.version}: ${source}, sha512 verified`);
      }
      const tarballs = [];
      for (const plugin of plugins) {
        // The package's own build, then the package as npm would publish it (`files` honored,
        // `workspace:` ranges rewritten) — nothing this script decides.
        await run("pnpm", ["--filter", plugin.name, "run", "build"], root, env);
        await run("pnpm", ["pack", "--pack-destination", packed], plugin.dir, env);
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
      // The external plugins join it once npm is done: listed while npm runs, it would resolve
      // them from the registry rather than leave the unpacked copies alone.
      const dependencies = Object.fromEntries(plugins.map((p) => [p.name, p.version]));
      const overrides = Object.fromEntries(closure);
      const writeManifest = () =>
        fsp.writeFile(
          path.join(out, "package.json"),
          `${JSON.stringify({ ...PREFIX_MANIFEST, dependencies, overrides }, null, 2)}\n`,
        );
      await writeManifest();
      if (tarballs.length > 0) {
        // npm installs the packages and their dependencies into the prefix; --no-save keeps
        // the prefix's manifest ours (no `file:` paths into a temp directory), --omit=dev
        // leaves the SDK's types and the build tools behind.
        await run(
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
          env,
        );
        // One call for every target: npm reconciles the tree on each install, so a second
        // install would prune the first target's package as extraneous. --force is what makes
        // npm accept a package whose `os`/`cpu` is not this machine's — the point of the call.
        const platformPackages = platformSpecs(lock, closure);
        if (platformPackages.length > 0) {
          await run(
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
            env,
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
      // After npm, which would prune a package its manifest does not name.
      for (const { pin, dir } of staged) {
        await fsp.cp(dir, path.join(out, "node_modules", ...pin.name.split("/")), {
          recursive: true,
        });
        dependencies[pin.name] = pin.version;
      }
      if (staged.length > 0) await writeManifest();
      await stageOfflineArchives({
        out,
        candidates: offline,
        build: (plugin) => run("pnpm", ["--filter", plugin.name, "run", "build"], root, env),
        pack: async (dir, into) => {
          const before = new Set(await fsp.readdir(into));
          await run("pnpm", ["pack", "--pack-destination", into], dir, env);
          const made = (await fsp.readdir(into)).find((f) => f.endsWith(".tgz") && !before.has(f));
          if (made === undefined) throw new Error(`pnpm pack left no tarball in ${dir}`);
          return path.join(into, made);
        },
        log,
      });
      // npm installs a package's files with the mode it pleases, and a vendored program
      // arrives without its exec bit — which no consumer of the prefix can guess back.
      for (const rel of await walk(out)) {
        if (/(^|\/)vendor\/[^/]+\/bin\/[^/]+$/.test(rel)) {
          await fsp.chmod(path.join(out, rel), 0o755);
        }
      }
      await fsp.writeFile(path.join(out, COMPLETE), hash);
      log(`${Object.keys(dependencies).length} builtin plugins: installed (${hash})`);
    } catch (err) {
      await fsp.rm(out, { recursive: true, force: true });
      throw err;
    } finally {
      await fsp.rm(packed, { recursive: true, force: true });
    }
  }
  const files = (await walk(out)).filter((f) => f !== COMPLETE && !NOT_SHIPPED.has(f));
  // What the prefix holds is what its manifest names, cached or not: an external package
  // without a code entry is pinned but not in it.
  const { dependencies } = JSON.parse(await fsp.readFile(path.join(out, "package.json"), "utf8"));
  const shipped = Object.entries(dependencies ?? {}).map(([name, version]) => ({ name, version }));
  return { dir: out, files, plugins: shipped };
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
  const built = await buildBuiltinPlugins({ log: (m) => console.log(`[build-plugins] ${m}`) });
  if (out) {
    await stagePrefix(built, path.resolve(out));
    console.log(
      `[build-plugins] staged ${built.plugins.length} plugins (${built.files.length} files) into ${path.resolve(out)}`,
    );
  }
}
