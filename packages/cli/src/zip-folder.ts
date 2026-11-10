/**
 * A folder as the zip a server's upload route reads: every regular file under one top-level
 * `<rootName>/`, the `leftOut` names and links skipped. Shared by `penguin plugin install <dir>`
 * and `penguin agent import <dir>`, each with the caps of the route it uploads to.
 */
import fs from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

export interface ZipCaps {
  files: number;
  fileBytes: number;
  totalBytes: number;
  zipBytes: number;
  /** Names never uploaded, at any depth. */
  leftOut: ReadonlySet<string>;
}

/** The zip and its file count; null past `caps` — the upload would be refused anyway, so nothing is sent. */
export function zipFolder(
  dir: string,
  rootName: string,
  caps: ZipCaps,
): { zip: Uint8Array; files: number } | null {
  const out: Record<string, Uint8Array> = {};
  let files = 0;
  let total = 0;
  const walk = (abs: string, rel: string): boolean => {
    const entries = fs.readdirSync(abs, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      if (caps.leftOut.has(entry.name)) continue;
      const childAbs = path.join(abs, entry.name);
      const childRel = rel === "" ? entry.name : `${rel}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!walk(childAbs, childRel)) return false;
      } else if (entry.isFile()) {
        // Sized before a byte is read: a file past the caps is never loaded (one over 2 GiB
        // could not be read whole at all).
        const size = fs.statSync(childAbs).size;
        files += 1;
        total += size;
        if (files > caps.files || size > caps.fileBytes || total > caps.totalBytes) return false;
        out[`${rootName}/${childRel}`] = new Uint8Array(fs.readFileSync(childAbs));
      }
    }
    return true;
  };
  if (!walk(dir, "")) return null;
  const zip = zipSync(out);
  return zip.byteLength > caps.zipBytes ? null : { zip, files };
}
