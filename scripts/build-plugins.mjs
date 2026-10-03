/**
 * The builtin plugins, shipped as the npm packages they are: every `plugins/*` package with a
 * code entry is built by its own `build` script and packed once by `pnpm pack` — exactly what
 * `npm publish` would send — and that tarball is unpacked into the bundled plugin directory, a
 * prefix the server finds plugins in as they are:
 *
 *   index.json                          one row per plugin: name, version, …, integrity
 *   node_modules/<name>/                the package, unpacked; `.integrity` is its tarball's
 *
 * The hot push ships it under `plugins/` in its assets (one archive per package), the desktop
 * build and the CLI bundle beside the program. The tarballs themselves stay here, for the
 * release to publish (`--tarballs`).
 *
 * A plugin packs itself: its tarball is the whole of it. Nothing here installs what a plugin
 * declares as dependencies, and the SDK's runtime is the host's — a plugin compiles against
 * `@prismshadow/penguin-core`'s types (a devDependency).
 *
 * THE INDEX'S INTEGRITY IS THE PUBLISHED TARBALL'S: npm's integrity (sha512 of its bytes, what
 * the registry reports as `dist.integrity`), and the release publishes that very file rather
 * than letting a publish command pack again — two packers pick the same files and still write
 * different bytes.
 *
 * Cached by content: the hash over every plugin's `src/`, `package.json`, `README.md`,
 * `tsup.config.ts` and shipped directories names a directory under
 * `node_modules/.cache/penguin-plugins/`, and an unchanged set is not built or packed again.
 *
 * Usage (a library for deploy.mjs / desktop build-assets.mjs, and a CLI):
 *   node scripts/build-plugins.mjs --out <dir>        write the bundled plugin directory to <dir>
 *   node scripts/build-plugins.mjs --tarballs <dir>   copy the tarballs and the index to <dir>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  INDEX_FILE,
  INTEGRITY_FILE,
  manifestOf,
  sortIndex,
  tarballIntegrity,
} from "./plugin-entry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_SRC = path.join(ROOT, "plugins");
const CACHE = path.join(ROOT, "node_modules", ".cache", "penguin-plugins");
const LICENSE = path.join(ROOT, "LICENSE");
const COMPLETE = ".complete";
/** Folded into the cache key: bump when what this script WRITES changes, not only what it reads. */
const PACK_FORMAT = 18;
/** Inside a cache entry: the prefix that ships, and the tarballs the release publishes. */
const PREFIX = "prefix";
const TARBALLS = "tarballs";

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
    out.push({ name: pkg.name, version: pkg.version, dir });
  }
  return out;
}

/**
 * Builds and packs every builtin plugin into one directory (from cache when nothing changed)
 * and returns `{ dir, files, tarballs, plugins }`: the prefix, the relative paths in it to ship,
 * the directory of the tarballs, and `[{ name, version }]` of what it holds.
 */
export async function buildBuiltinPlugins({ log = () => {} } = {}) {
  const plugins = await pluginPackages();
  const h = createHash("sha256").update(`pack ${PACK_FORMAT}\0`);
  h.update(await fsp.readFile(LICENSE)).update("\0");
  for (const plugin of plugins) {
    h.update(plugin.name).update("\0");
    await sourceHash(plugin.dir, h);
  }
  const hash = h.digest("hex").slice(0, 16);
  const out = path.join(CACHE, hash);
  const prefix = path.join(out, PREFIX);
  const tarballs = path.join(out, TARBALLS);
  if (fs.existsSync(path.join(out, COMPLETE))) {
    log(`${plugins.length} builtin plugins: cached (${hash})`);
  } else {
    await fsp.rm(out, { recursive: true, force: true });
    await fsp.mkdir(tarballs, { recursive: true });
    try {
      const index = [];
      for (const plugin of plugins) {
        // The package's own build, then the package as npm would publish it (`files` honored,
        // `workspace:` ranges rewritten) — nothing this script decides.
        run("pnpm", ["--filter", plugin.name, "run", "build"], ROOT);
        const before = new Set(await fsp.readdir(tarballs));
        // Every plugin's `files` names LICENSE and none tracks one: the repository's is lent for
        // the pack, so every channel carries the bytes the release uploads to npm (which copies
        // the same file in first) and the integrity agrees with `dist.integrity`.
        const license = path.join(plugin.dir, "LICENSE");
        const lent = !fs.existsSync(license);
        if (lent) await fsp.copyFile(LICENSE, license);
        try {
          run("pnpm", ["pack", "--pack-destination", tarballs], plugin.dir);
        } finally {
          if (lent) await fsp.rm(license, { force: true });
        }
        const tarball = (await fsp.readdir(tarballs)).find((f) => !before.has(f));
        if (tarball === undefined) throw new Error(`pnpm pack left no tarball for ${plugin.name}`);
        const abs = path.join(tarballs, tarball);
        const integrity = await tarballIntegrity(abs);
        // The tarball's top directory (`package/`) becomes node_modules/<name>/.
        const dest = path.join(prefix, "node_modules", ...plugin.name.split("/"));
        await fsp.mkdir(dest, { recursive: true });
        execFileSync("tar", ["-xzf", abs, "-C", dest, "--strip-components=1"]);
        await fsp.writeFile(path.join(dest, INTEGRITY_FILE), `${integrity}\n`);
        const pkg = JSON.parse(await fsp.readFile(path.join(dest, "package.json"), "utf8"));
        index.push(manifestOf(pkg, pkg.name, pkg.version, integrity));
        log(`plugin ${plugin.name}@${plugin.version}: packed`);
      }
      await fsp.writeFile(
        path.join(prefix, INDEX_FILE),
        `${JSON.stringify(sortIndex(index), null, 2)}\n`,
      );
      await fsp.writeFile(path.join(out, COMPLETE), hash);
      log(`${plugins.length} builtin plugins: packed (${hash})`);
    } catch (err) {
      await fsp.rm(out, { recursive: true, force: true });
      throw err;
    }
  }
  return {
    dir: prefix,
    files: await walk(prefix),
    tarballs,
    plugins: plugins.map(({ name, version }) => ({ name, version })),
  };
}

/** The prefix as a file map, relative to it, each value an absolute source path. */
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
    await fsp.chmod(target, (await fsp.stat(source.path)).mode);
  }
}

/** Copies the tarballs and the index into `dest`: what the release publishes and lists. */
export async function stageTarballs(built, dest) {
  await fsp.mkdir(dest, { recursive: true });
  for (const name of await fsp.readdir(built.tarballs)) {
    await fsp.copyFile(path.join(built.tarballs, name), path.join(dest, name));
  }
  await fsp.copyFile(path.join(built.dir, INDEX_FILE), path.join(dest, INDEX_FILE));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? null : path.resolve(process.argv[i + 1]);
  };
  const built = await buildBuiltinPlugins({ log: (m) => console.log(`[build-plugins] ${m}`) });
  const out = arg("--out");
  if (out !== null) {
    await stagePrefix(built, out);
    console.log(`[build-plugins] wrote ${built.plugins.length} plugins into ${out}`);
  }
  const tarballs = arg("--tarballs");
  if (tarballs !== null) {
    await stageTarballs(built, tarballs);
    console.log(`[build-plugins] copied ${built.plugins.length} tarballs into ${tarballs}`);
  }
}
