/**
 * Staging a crash left behind: a temporary directory or file whose name starts with a known
 * prefix and that nobody has touched for an hour. The code that stages there removes such
 * leftovers the next time it runs; anything younger may still be in use.
 */
import fs from "node:fs/promises";
import path from "node:path";

const STALE_MS = 60 * 60 * 1000;

/** Removes the entries of `dir` named `<prefix>…` that have not changed for an hour. */
export async function removeLeftovers(
  dir: string,
  prefix: string,
  now = Date.now(),
): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.startsWith(prefix)) continue;
    const entry = path.join(dir, name);
    const stat = await fs.lstat(entry).catch(() => null);
    if (stat !== null && now - stat.mtimeMs > STALE_MS) {
      await fs.rm(entry, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
