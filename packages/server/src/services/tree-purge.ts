/**
 * Removing a large directory tree without stalling the server.
 *
 * `fs.promises.rm(dir, { recursive: true })` walks the tree by starting the removal of every
 * child of a directory at once, all the way down: a folder of a hundred thousand files puts a
 * hundred thousand requests in libuv's thread pool queue together. That queue is shared by every
 * file read the server makes (a page's list, a static asset, a Trace), and it is first in, first
 * out — so each of those waits behind the whole tree, and the server looks frozen for as long as
 * the removal takes. The walk here keeps at most `concurrency` filesystem calls of its own in
 * flight across every purge sharing a `FsLimiter`, so any other request waits behind a handful of
 * them at most.
 *
 * Two passes, each reporting as it goes: `countEntries` learns how much there is, so a reader can
 * be shown how far along the removal is; `purgeTree` then removes files before the directory that
 * held them, depth first. A symbolic link is removed as a link and never followed. An entry that
 * is already gone counts as removed: another purge of the same tree (a successor process taking
 * over) may have got there first. An entry that cannot be removed is skipped and reported, and
 * its directories stay behind, so a later purge of the same tree can try again.
 */
import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";

/** At most `slots` calls run at once; the rest wait their turn, first come first served. */
export class FsLimiter {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly slots: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.slots) {
      await new Promise<void>((resolve) => this.waiting.push(resolve));
    } else {
      this.active += 1;
    }
    try {
      return await fn();
    } finally {
      const next = this.waiting.shift();
      // The slot passes straight to the next waiter, so `active` stays counted for it.
      if (next) next();
      else this.active -= 1;
    }
  }
}

/** What a purge could not remove: how many entries, and the first error, as the OS worded it. */
export interface PurgeFailure {
  failed: number;
  error: string;
}

export interface PurgeOptions {
  limiter: FsLimiter;
  /** Stops the walk between calls; whatever is left stays on disk for a later purge. */
  signal?: AbortSignal;
}

const code = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code;

/**
 * Windows reports a file or folder another program has open as busy or not permitted, and lets go
 * of it a moment later more often than not (an indexer, an antivirus scan): the same few retries
 * Node's own `rm` makes before giving up.
 */
const RETRYABLE = new Set(["EBUSY", "EPERM", "EACCES", "ENOTEMPTY", "EMFILE", "ENFILE"]);
const RETRIES = 3;
/** Files of one directory removed side by side; the limiter still caps what actually runs. */
const FILE_LANES = 8;
const RETRY_STEP_MS = 100;

async function withRetries(fn: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fn();
      return;
    } catch (err) {
      if (code(err) === "ENOENT") return;
      if (attempt >= RETRIES || !RETRYABLE.has(code(err) ?? "")) throw err;
      await new Promise((resolve) => setTimeout(resolve, RETRY_STEP_MS * (attempt + 1)));
    }
  }
}

async function readEntries(dir: string, limiter: FsLimiter): Promise<Dirent[]> {
  try {
    return await limiter.run(() => fs.readdir(dir, { withFileTypes: true }));
  } catch (err) {
    if (code(err) === "ENOENT" || code(err) === "ENOTDIR") return [];
    throw err;
  }
}

/** Runs `fn` over `items` with at most `width` of them in progress, in order of starting. */
async function eachLimited<T>(
  items: readonly T[],
  width: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await fn(item);
    }
  });
  await Promise.all(lanes);
}

/**
 * How many entries `root` holds, itself included: what `purgeTree` will report as removed once it
 * has removed all of it. `onCount` hears the running total after each directory is read.
 */
export async function countEntries(
  root: string,
  opts: PurgeOptions & { onCount?: (total: number) => void },
): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    if (opts.signal?.aborted) return;
    const entries = await readEntries(dir, opts.limiter);
    total += entries.length;
    opts.onCount?.(total);
    // Directories one at a time, depth first: lanes per level would multiply with the depth.
    for (const e of entries) if (e.isDirectory()) await walk(path.join(dir, e.name));
  };
  try {
    await opts.limiter.run(() => fs.lstat(root));
  } catch (err) {
    if (code(err) === "ENOENT") return 0;
    throw err;
  }
  total = 1;
  await walk(root);
  return total;
}

/**
 * Removes `root` and everything under it. `onRemoved` hears each entry as it goes. Resolves with
 * what could not be removed (its error naming the entry by its path under `root`), or null when
 * nothing is left; never rejects for an entry it could not remove (only an abort ends it early,
 * leaving the rest).
 */
export async function purgeTree(
  root: string,
  opts: PurgeOptions & { onRemoved?: () => void },
): Promise<PurgeFailure | null> {
  let failed = 0;
  let firstError = "";
  const fail = (err: unknown): void => {
    failed += 1;
    if (firstError !== "") return;
    // The OS names the entry by its absolute path; inside the tree, its place in it says more.
    const message = err instanceof Error ? err.message : String(err);
    firstError = message.split(root + path.sep).join("");
  };
  const removed = (): void => opts.onRemoved?.();

  const unlink = async (file: string): Promise<void> => {
    try {
      await withRetries(() =>
        opts.limiter.run(async () => {
          try {
            await fs.unlink(file);
          } catch (err) {
            // A read-only file on Windows refuses to be unlinked until it is made writable.
            if (code(err) !== "EPERM" && code(err) !== "EACCES") throw err;
            await fs.chmod(file, 0o666).catch(() => undefined);
            await fs.unlink(file);
          }
        }),
      );
      removed();
    } catch (err) {
      fail(err);
    }
  };

  /** Removes `dir`'s contents and then `dir`; false when something under it stayed behind. */
  const walk = async (dir: string): Promise<boolean> => {
    let entries: Dirent[];
    try {
      entries = await readEntries(dir, opts.limiter);
    } catch (err) {
      fail(err);
      return false;
    }
    const before = failed;
    const files = entries.filter((e) => !e.isDirectory()).map((e) => path.join(dir, e.name));
    await eachLimited(files, FILE_LANES, async (file) => {
      if (!opts.signal?.aborted) await unlink(file);
    });
    for (const e of entries) {
      if (e.isDirectory() && !opts.signal?.aborted) await walk(path.join(dir, e.name));
    }
    if (opts.signal?.aborted || failed > before) return false;
    try {
      await withRetries(() => opts.limiter.run(() => fs.rmdir(dir)));
      removed();
      return true;
    } catch (err) {
      fail(err);
      return false;
    }
  };

  let stat;
  try {
    stat = await opts.limiter.run(() => fs.lstat(root));
  } catch (err) {
    if (code(err) === "ENOENT") return null;
    fail(err);
    return { failed, error: firstError };
  }
  if (stat.isDirectory()) await walk(root);
  else await unlink(root);
  return failed > 0 ? { failed, error: firstError } : null;
}
