/**
 * Offline archives for the builtin prefix (05 「插件库」 「安装从不卡住」): every package under
 * `plugins/` that the market lists in the server's own index (`builtin-index.json`) but that the
 * build does NOT ship — not preinstalled, not in the builtin prefix (Computer Use) — is packed the
 * way `npm publish` would send it and staged under `<prefix>/offline/`:
 *
 *   offline/<tarball>.tgz            the package, exactly what `pnpm pack` writes
 *   offline/<unscoped name>/         its own package.json and ifaces.json, so the server reads what
 *                                    it carries by core's one rule without unpacking anything
 *   offline/index.json               [{ name, version, file, integrity, meta }]
 *
 * An archive is not an install: the server lists, loads and preinstalls nothing from it; the
 * market installs from it only when the registry cannot serve the name
 * (packages/server/src/plugin/offline-archives.ts).
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

export const OFFLINE_DIR = "offline";

/**
 * The packages to carry as offline archives: listed in `indexFile`, found under `pluginsSrc`, and
 * not among `shipped` (the names the builtin prefix carries). Sorted by directory name.
 */
export async function offlineCandidates({ pluginsSrc, indexFile, shipped }) {
  const listed = new Set(
    JSON.parse(await fsp.readFile(indexFile, "utf8")).map((row) => String(row.name)),
  );
  const out = [];
  const dirs = fs.existsSync(pluginsSrc) ? await fsp.readdir(pluginsSrc) : [];
  for (const dirName of dirs.sort()) {
    const dir = path.join(pluginsSrc, dirName);
    const manifestFile = path.join(dir, "package.json");
    if (!fs.existsSync(manifestFile)) continue;
    const pkg = JSON.parse(await fsp.readFile(manifestFile, "utf8"));
    if (typeof pkg.name !== "string" || !listed.has(pkg.name) || shipped.has(pkg.name)) continue;
    out.push({ name: pkg.name, version: pkg.version, dir });
  }
  return out;
}

/** `sha512-<base64>` of `bytes`, npm's integrity shape. */
export function integrityOf(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}

/**
 * Builds and packs each candidate into `<out>/offline/` and writes the index (see the header).
 * `pack(dir, into)` packs one package directory and answers the tarball's absolute path; `build`
 * runs the package's own build first. Throws when a built package has no `ifaces.json`.
 */
export async function stageOfflineArchives({ out, candidates, build, pack, log = () => {} }) {
  if (candidates.length === 0) return [];
  const dir = path.join(out, OFFLINE_DIR);
  await fsp.mkdir(dir, { recursive: true });
  const rows = [];
  for (const candidate of candidates) {
    build(candidate);
    const ifaces = path.join(candidate.dir, "ifaces.json");
    if (!fs.existsSync(ifaces)) {
      throw new Error(`${candidate.name} has no ifaces.json after its build: it cannot be carried`);
    }
    const tarball = await pack(candidate.dir, dir);
    const file = path.basename(tarball);
    const meta = candidate.name.replace(/^@[^/]+\//, "");
    await fsp.mkdir(path.join(dir, meta), { recursive: true });
    await fsp.copyFile(
      path.join(candidate.dir, "package.json"),
      path.join(dir, meta, "package.json"),
    );
    await fsp.copyFile(ifaces, path.join(dir, meta, "ifaces.json"));
    rows.push({
      name: candidate.name,
      version: candidate.version,
      file,
      integrity: integrityOf(await fsp.readFile(path.join(dir, file))),
      meta,
    });
    log(`plugin ${candidate.name}@${candidate.version}: carried as an offline archive`);
  }
  await fsp.writeFile(path.join(dir, "index.json"), `${JSON.stringify(rows, null, 2)}\n`);
  return rows;
}
