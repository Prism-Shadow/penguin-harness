/**
 * Moving one folder to its new place in the data root: a `rename`, which inside one filesystem
 * is atomic — the folder is wholly at its old place or wholly at its new one, whatever stops the
 * process. Windows refuses a rename while another program holds a handle in the folder (an
 * indexer, an antivirus scan, an editor), so a refusal there is tried again for a few seconds
 * before the step fails.
 *
 * Compatibility owner: core's `state/layout-migration/`, removed with the migration at 1.0.
 */
import type { Stats } from "node:fs";
import fs from "node:fs/promises";

/** The codes Windows answers a rename with while something holds the folder open. */
const HELD = new Set(["EPERM", "EBUSY", "EACCES"]);
const ATTEMPTS = 8;

/** `fs.lstat`, or null when nothing is there. */
export async function lstatOrNull(p: string): Promise<Stats | null> {
  try {
    return await fs.lstat(p);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** Whether `p` is a real directory: there, and neither a link (a junction included) nor a file. */
export async function isRealDir(p: string): Promise<boolean> {
  return (await lstatOrNull(p))?.isDirectory() === true;
}

/**
 * Whether `err` is Windows refusing a rename while something holds the folder, or a file in it,
 * open.
 */
export function heldOpen(err: unknown, platform: NodeJS.Platform = process.platform): boolean {
  return platform === "win32" && HELD.has((err as NodeJS.ErrnoException | null)?.code ?? "");
}

/** Renames the folder `from` to `to`, whose parent exists and which does not exist itself. */
export async function moveDir(
  from: string,
  to: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      if (!heldOpen(err, platform) || attempt >= ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 150 * attempt));
    }
  }
}
