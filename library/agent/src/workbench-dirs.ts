/**
 * A workbench folder's link-safety helpers, moved from the server's workbenches/data-dirs.ts
 * beside their package consumer (the agent domain's agent-app-data, services+http+cli restack
 * S3). The server's data-dirs re-exports them for its own import paths.
 *
 * Nothing here goes through a link: making a folder checks every level below its trusted base
 * is a real directory, and removing one never reaches through a link on the way.
 */
import fs from "node:fs/promises";
import path from "node:path";

export class WorkbenchDirError extends Error {}

/**
 * Whether every directory from `base` down through `segments` is there, each a real directory:
 * false when one is simply missing; a link or a file on the way throws. `base` itself is trusted.
 */
export async function realDirs(
  base: string,
  segments: readonly string[],
  call: string,
): Promise<boolean> {
  let at = base;
  for (const segment of segments) {
    at = path.join(at, segment);
    const stat = await fs.lstat(at).catch(() => null);
    if (stat === null) return false;
    if (!stat.isDirectory()) {
      throw new WorkbenchDirError(`${call}: ${at} is a link or a file, not a directory`);
    }
  }
  return true;
}

/**
 * Removes `dir` and everything in it, `dir` lying below the trusted `base`. A link on the way
 * to it throws and nothing is removed; `dir` itself as a link goes as a link, and `rm` removes a
 * link inside without following it.
 */
export async function removeBelow(base: string, dir: string): Promise<void> {
  const levels = path.relative(base, dir).split(path.sep);
  if (!(await realDirs(base, levels.slice(0, -1), "remove"))) return;
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
