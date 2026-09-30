/**
 * Pushed assets travel as archives. Every file a push carries is one blob, one probe entry
 * and one transfer, and a native module or an npm prefix is hundreds of small files — so the
 * deploy packs each package into one deterministic `.tgz` under `archives/` (one per plugin
 * package, one for node-pty; see scripts/asset-archives.mjs), and the platform unpacks them
 * here, once per assets directory, before anything resolves from it.
 *
 * The output goes to `.unpacked/` inside the assets directory, laid out as the files were
 * before packing (`plugins/package.json`, `plugins/node_modules/…`, `node_modules/node-pty/…`).
 * The assets directory is content-addressed, so its archives never change and one extraction
 * serves every later boot: `.complete`, written last, is what proves it finished — a directory
 * without it is a crash mid-extraction and is redone. The runtime removes it with the assets
 * directory; a hand-over forwarding the build to a machine skips it (hmr/pushed-build.ts),
 * so the machine unpacks its own.
 *
 * An assets directory with no `archives/` (a push from before archives, or a packaged
 * runtime's own) is used as it is.
 */
import fs from "node:fs";
import path from "node:path";
import * as tar from "tar";

/** Where a push puts its archives, relative to the assets directory. */
export const ARCHIVES_DIR = "archives";
/** Where they are unpacked, relative to the assets directory. */
export const UNPACKED_DIR = ".unpacked";
const COMPLETE = ".complete";

/**
 * The directory the assets resolve from: `<dir>/.unpacked` once its archives are extracted
 * (extracting them first if they are not), or `dir` itself when it holds no archives.
 * Synchronous, because node-pty is resolved synchronously.
 */
export function unpackedAssetsDir(dir: string): string {
  const archivesDir = path.join(dir, ARCHIVES_DIR);
  let archives: string[];
  try {
    archives = fs
      .readdirSync(archivesDir)
      .filter((name) => name.endsWith(".tgz"))
      .sort();
  } catch {
    return dir;
  }
  if (archives.length === 0) return dir;
  const out = path.join(dir, UNPACKED_DIR);
  if (fs.existsSync(path.join(out, COMPLETE))) return out;
  // Extracted beside and renamed in, so a reader never sees half a tree; a leftover from a
  // crashed attempt is cleared first.
  const tmp = `${out}.${process.pid}.tmp`;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  for (const name of archives) {
    tar.x({ sync: true, file: path.join(archivesDir, name), cwd: tmp });
  }
  fs.writeFileSync(path.join(tmp, COMPLETE), archives.join("\n"));
  fs.rmSync(out, { recursive: true, force: true });
  try {
    fs.renameSync(tmp, out);
  } catch (err) {
    // Another process unpacked the same content first: theirs is as good as ours.
    fs.rmSync(tmp, { recursive: true, force: true });
    if (!fs.existsSync(path.join(out, COMPLETE))) throw err;
  }
  return out;
}
