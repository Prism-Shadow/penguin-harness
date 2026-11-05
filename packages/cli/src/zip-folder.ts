/**
 * A folder as a zip in memory, for `penguin agent import <folder>`: every regular file under the
 * folder, at its path relative to it, so the folder's `manifest.json` is the zip's root manifest.
 * Files are read and deflated one at a time through fflate's streaming `Zip`, so memory holds the
 * zip and one file's chunk, never the whole folder.
 *
 * `.git` directories are left out (an archive import drops them anyway), and so are symbolic links
 * and other special files, which never belong in an archive. Zipping stops as soon as the zip
 * grows past `maxBytes`: the server would refuse the upload, so nothing more is read.
 */
import fs from "node:fs";
import path from "node:path";
import { Zip, ZipDeflate } from "fflate";

/** The folder `dir` as a zip, or null once the zip grows past `maxBytes`. */
export async function zipFolder(dir: string, maxBytes: number): Promise<Uint8Array | null> {
  const out = { chunks: [] as Uint8Array[], bytes: 0, failure: null as Error | null };
  const zip = new Zip((err, chunk) => {
    if (err !== null) {
      out.failure = err;
      return;
    }
    out.chunks.push(chunk);
    out.bytes += chunk.byteLength;
  });
  const tooLarge = () => out.bytes > maxBytes;

  /** Adds every file under `abs` (zip path `rel`); false once the zip is too large. */
  const walk = async (abs: string, rel: string): Promise<boolean> => {
    const entries = await fs.promises.readdir(abs, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!(await walk(childAbs, childRel))) return false;
        continue;
      }
      if (!entry.isFile()) continue;
      const file = new ZipDeflate(childRel, { level: 6 });
      zip.add(file);
      for await (const chunk of fs.createReadStream(childAbs)) {
        file.push(chunk as Buffer);
        if (tooLarge()) return false;
      }
      file.push(new Uint8Array(0), true);
      if (tooLarge()) return false;
    }
    return true;
  };

  if (!(await walk(dir, ""))) {
    zip.terminate();
    return null;
  }
  zip.end();
  if (out.failure !== null) throw out.failure;
  if (tooLarge()) return null;
  return Buffer.concat(out.chunks);
}
