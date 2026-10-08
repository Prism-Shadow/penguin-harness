/**
 * The rename that finishes a write-beside-then-rename, retried while Windows holds the target.
 *
 * Windows refuses to replace a file that another process has open without delete sharing, and
 * answers with EPERM, EACCES or EBUSY until that handle closes. Defender scanning the fresh
 * temp file, the search indexer, an editor or a git watcher on a module checkout all do this
 * for a few milliseconds at a time, so a lone rename fails a whole generation stage on what is
 * a passing lock. POSIX replaces an open file without complaint, so the retry is Windows only:
 * there EACCES is a real permission error and has to surface at once.
 *
 * Retrying to a deadline rather than ignoring the error: a lock nothing releases still fails,
 * one deadline later, with the original error.
 */
import fs from "node:fs/promises";

const TRANSIENT = new Set(["EPERM", "EACCES", "EBUSY"]);

export interface RenameOverOptions {
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

/** Renames `from` over `to`, waiting out a transient Windows lock on either. */
export async function renameOver(
  from: string,
  to: string,
  { platform = process.platform, timeoutMs = 10_000 }: RenameOverOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (let delay = 20; ; delay = Math.min(delay * 2, 500)) {
    try {
      await fs.rename(from, to);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code ?? "";
      if (platform !== "win32" || !TRANSIENT.has(code) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
