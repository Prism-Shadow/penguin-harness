/**
 * Packs pushed assets into archives: one deterministic `.tgz` per package, so a push carries a
 * handful of blobs instead of one per file (the platform unpacks them — see
 * packages/server/src/hmr/asset-archives.ts, which also documents the layout).
 *
 * Deterministic, because blobs are content-addressed: the same files must produce the same
 * bytes on every run, or an unchanged package would be uploaded again on every push. Entries are
 * sorted, every mtime is the epoch, owners are dropped (`portable`), and each file's mode is set
 * explicitly — 0755 for what must execute, 0644 otherwise — rather than read off this machine,
 * whose filesystem may not keep an exec bit at all.
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The server's own dependency: the platform unpacks with the same library.
const tar = createRequire(path.join(ROOT, "packages", "server", "package.json"))("tar");

/**
 * One archive over `entries` — `{ rel, abs, exec }`, `rel` the path inside the archive (posix,
 * relative to the directory it unpacks into) — returned as bytes.
 */
export async function packArchive(entries) {
  const stage = await fsp.mkdtemp(path.join(os.tmpdir(), "penguin-archive-"));
  try {
    const rels = [...entries].sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    for (const { rel, abs, exec } of rels) {
      const target = path.join(stage, ...rel.split("/"));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.copyFile(abs, target);
      await fsp.chmod(target, exec ? 0o755 : 0o644);
    }
    const out = path.join(stage, "..", `${path.basename(stage)}.tgz`);
    await tar.c(
      {
        gzip: true,
        file: out,
        cwd: stage,
        portable: true,
        mtime: new Date(0),
        noDirRecurse: true,
      },
      rels.map((e) => e.rel),
    );
    const bytes = await fsp.readFile(out);
    await fsp.rm(out, { force: true });
    return bytes;
  } finally {
    await fsp.rm(stage, { recursive: true, force: true });
  }
}

/** An archive's file name for a package: `@scope/name` → `scope__name`. */
export function archiveName(prefix, pkg) {
  return `${prefix}${pkg.replace(/^@/, "").replace(/\//g, "__")}.tgz`;
}

/**
 * The top-level packages of an npm prefix's `node_modules`, each with its files (`rel` relative
 * to the prefix's parent, so they unpack under `<dirName>/node_modules/…`): what gets one
 * archive apiece. A package's own nested `node_modules` stays inside its archive.
 */
export async function prefixPackages(prefixDir, files, dirName) {
  const byPackage = new Map();
  const loose = [];
  for (const rel of files) {
    const parts = rel.split("/");
    if (parts[0] !== "node_modules") {
      loose.push({ rel: `${dirName}/${rel}`, abs: path.join(prefixDir, rel), exec: false });
      continue;
    }
    const pkg = parts[1]?.startsWith("@") ? `${parts[1]}/${parts[2]}` : parts[1];
    const list = byPackage.get(pkg) ?? [];
    const abs = path.join(prefixDir, rel);
    list.push({ rel: `${dirName}/${rel}`, abs, exec: isExecutable(abs) });
    byPackage.set(pkg, list);
  }
  return { byPackage, loose };
}

function isExecutable(abs) {
  try {
    return (fs.statSync(abs).mode & 0o111) !== 0;
  } catch {
    return false;
  }
}
