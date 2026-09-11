/**
 * The builtin plugins, shipped as the npm packages they are: every `plugins/*` package that
 * declares `penguin` is built by its own `build` script, packed by `pnpm pack` — exactly what
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
 * Cached by content: the hash over every plugin's `src/`, `package.json`, `README.md` and
 * `tsup.config.ts` names a directory under `node_modules/.cache/penguin-plugins/`, and an
 * unchanged set is not built, packed or installed again — a push of an unrelated change costs
 * nothing here. Installing needs the registry (for the dependencies) the first time only.
 *
 * Usage (a library for deploy.mjs / desktop build-assets.mjs, and a CLI):
 *   node scripts/build-plugins.mjs --out <dir>      stage the prefix into <dir>
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_SRC = path.join(ROOT, "plugins");
const CACHE = path.join(ROOT, "node_modules", ".cache", "penguin-plugins");
const COMPLETE = ".complete";
/** Folded into the cache key: bump when what this script WRITES changes, not only what it reads. */
const PACK_FORMAT = 3;
/** The prefix's own manifest: npm needs one above `node_modules`, and it is ours, never a package's. */
const PREFIX_MANIFEST = { name: "penguin-builtin-plugins", private: true, version: "0.0.0" };
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
function run(name, args, cwd) {
  try {
    execFileSync(command(name), args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
      env: process.env,
    });
  } catch (err) {
    const stderr = err instanceof Object && "stderr" in err ? String(err.stderr).trim() : "";
    throw new Error(`${name} ${args.slice(0, 3).join(" ")} failed in ${cwd}\n${stderr}`);
  }
}

/** What a plugin's pack depends on: its sources, its manifest, its README and its build config. */
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
  const src = path.join(dir, "src");
  if (fs.existsSync(src)) {
    for (const rel of await walk(src)) {
      into
        .update(`src/${rel}`)
        .update("\0")
        .update(await fsp.readFile(path.join(src, rel)))
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
    // Only a plugin package: a helper package under the same directory would not declare modules.
    if (pkg.penguin === undefined) continue;
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
  const h = createHash("sha256").update(`pack ${PACK_FORMAT}\0`);
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
    const packed = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-plugins-pack-"));
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
      await fsp.writeFile(
        path.join(out, "package.json"),
        `${JSON.stringify(PREFIX_MANIFEST, null, 2)}\n`,
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
      }
      await fsp.writeFile(path.join(out, COMPLETE), hash);
      log(`${plugins.length} builtin plugins: installed (${hash})`);
    } catch (err) {
      await fsp.rm(out, { recursive: true, force: true });
      throw err;
    } finally {
      await fsp.rm(packed, { recursive: true, force: true });
    }
  }
  const files = (await walk(out)).filter((f) => f !== COMPLETE && !NOT_SHIPPED.has(f));
  return { dir: out, files, plugins: plugins.map(({ name, version }) => ({ name, version })) };
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
