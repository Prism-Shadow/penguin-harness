/**
 * The builtin plugins, packed: every `plugins/*` bundled self-contained and laid out
 * as an npm prefix (`<out>/package.json` + `<out>/node_modules/<name>/…`), which is the one
 * shape both consumers resolve from — the hot push ships it under `plugins/` in its assets,
 * the desktop build stages it beside `skills/`.
 *
 * Self-contained on purpose: a plugin's dependencies are bundled in (esbuild, `bundle:
 * true`), so what ships is `index.js` + `package.json` + `README.md` and nothing to install
 * on the far side. Only the SDK's type-only surface stays external. All five bundle without
 * a native module today; one that could not would be reported and skipped, not shipped
 * broken.
 *
 * Cached by content: the hash of a plugin's `src/`, `package.json` and `README.md` names a
 * directory under `node_modules/.cache/penguin-plugins/`, and an unchanged plugin is not
 * bundled again — a push of an unrelated change costs nothing here.
 *
 * Usage (a library for deploy.mjs / desktop build-assets.mjs, and a CLI):
 *   node scripts/build-plugins.mjs --out <dir>      stage the prefix into <dir>
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGINS_SRC = path.join(ROOT, "plugins");
const CACHE = path.join(ROOT, "node_modules", ".cache", "penguin-plugins");
const COMPLETE = ".complete";

/** Files under `dir`, as sorted relative posix paths. */
async function walk(dir, prefix = "") {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const rel = prefix === "" ? e.name : `${prefix}/${e.name}`;
    if (e.isDirectory()) out.push(...(await walk(path.join(dir, e.name), rel)));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

/** What a plugin's pack depends on: its sources, its manifest, its README — and the bundler. */
async function sourceHash(dir, esbuildVersion) {
  const h = createHash("sha256").update(`esbuild ${esbuildVersion}\0`);
  for (const rel of ["package.json", "README.md"]) {
    const file = path.join(dir, rel);
    if (fs.existsSync(file))
      h.update(rel)
        .update("\0")
        .update(await fsp.readFile(file))
        .update("\0");
  }
  const src = path.join(dir, "src");
  if (fs.existsSync(src)) {
    for (const rel of await walk(src)) {
      h.update(`src/${rel}`)
        .update("\0")
        .update(await fsp.readFile(path.join(src, rel)))
        .update("\0");
    }
  }
  return h.digest("hex").slice(0, 16);
}

/** The manifest that ships: the package as npm would publish it, minus what bundling made moot. */
function shippedManifest(pkg) {
  const {
    dependencies: _d,
    devDependencies: _dd,
    peerDependencies: _pd,
    scripts: _s,
    files: _f,
    types: _t,
    ...rest
  } = pkg;
  return {
    ...rest,
    type: "module",
    main: "./index.js",
    exports: { ".": { import: "./index.js" } },
  };
}

/**
 * Bundles every builtin plugin (from cache when its sources are unchanged) and returns
 * `[{ name, version, dir, files }]`, where `dir` holds exactly the files to ship.
 */
export async function buildBuiltinPlugins({ log = () => {} } = {}) {
  const require = createRequire(path.join(ROOT, "packages", "server", "package.json"));
  const esbuild = require("esbuild");
  const built = [];
  const entries = fs.existsSync(PLUGINS_SRC) ? await fsp.readdir(PLUGINS_SRC) : [];
  for (const dirName of entries.sort()) {
    const dir = path.join(PLUGINS_SRC, dirName);
    const manifestFile = path.join(dir, "package.json");
    const entry = path.join(dir, "src", "index.ts");
    if (!fs.existsSync(manifestFile) || !fs.existsSync(entry)) continue;
    const pkg = JSON.parse(await fsp.readFile(manifestFile, "utf8"));
    // Only a plugin package: a helper package under the same directory would not declare modules.
    if (pkg.penguin === undefined) continue;

    const hash = await sourceHash(dir, esbuild.version);
    const out = path.join(CACHE, dirName, hash);
    if (!fs.existsSync(path.join(out, COMPLETE))) {
      await fsp.rm(out, { recursive: true, force: true });
      await fsp.mkdir(out, { recursive: true });
      try {
        await esbuild.build({
          entryPoints: [entry],
          bundle: true,
          format: "esm",
          platform: "node",
          target: "node24",
          outfile: path.join(out, "index.js"),
          logLevel: "silent",
          // The SDK is the host's: a plugin compiles against its types and must never carry
          // a second copy of its runtime.
          external: ["@prismshadow/penguin-core", "@prismshadow/penguin-core/*"],
        });
      } catch (err) {
        log(
          `plugin ${pkg.name}: bundle failed, not shipped — ${err instanceof Error ? err.message.split("\n")[0] : String(err)}`,
        );
        await fsp.rm(out, { recursive: true, force: true });
        continue;
      }
      await fsp.writeFile(
        path.join(out, "package.json"),
        `${JSON.stringify(shippedManifest(pkg), null, 2)}\n`,
      );
      const readme = path.join(dir, "README.md");
      if (fs.existsSync(readme)) await fsp.copyFile(readme, path.join(out, "README.md"));
      await fsp.writeFile(path.join(out, COMPLETE), hash);
      log(`plugin ${pkg.name}@${pkg.version}: bundled (${hash})`);
    } else {
      log(`plugin ${pkg.name}@${pkg.version}: cached (${hash})`);
    }
    const files = (await walk(out)).filter((f) => f !== COMPLETE);
    built.push({ name: pkg.name, version: pkg.version, dir: out, files });
  }
  return built;
}

/**
 * The prefix layout as a file map, relative to the prefix: `package.json` for the prefix
 * itself (what `createRequire(<prefix>/package.json)` resolves from), then each plugin under
 * `node_modules/<name>/`. Values are absolute source paths, or inline text for the prefix's
 * own manifest.
 */
export function prefixLayout(built) {
  const files = new Map();
  files.set("package.json", {
    text: `${JSON.stringify({ name: "penguin-builtin-plugins", private: true, version: "0.0.0" }, null, 2)}\n`,
  });
  for (const plugin of built) {
    for (const rel of plugin.files) {
      files.set(`node_modules/${plugin.name}/${rel}`, { path: path.join(plugin.dir, rel) });
    }
  }
  return files;
}

/** Writes the prefix layout into `dest`, replacing what was there. */
export async function stagePrefix(built, dest) {
  await fsp.rm(dest, { recursive: true, force: true });
  for (const [rel, source] of prefixLayout(built)) {
    const target = path.join(dest, ...rel.split("/"));
    await fsp.mkdir(path.dirname(target), { recursive: true });
    if (source.text !== undefined) await fsp.writeFile(target, source.text);
    else await fsp.copyFile(source.path, target);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outIdx = process.argv.indexOf("--out");
  const out = outIdx === -1 ? null : process.argv[outIdx + 1];
  const built = await buildBuiltinPlugins({ log: (m) => console.log(`[build-plugins] ${m}`) });
  if (out) {
    await stagePrefix(built, path.resolve(out));
    console.log(`[build-plugins] staged ${built.length} plugins into ${path.resolve(out)}`);
  }
}
