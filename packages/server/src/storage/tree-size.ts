/**
 * How many bytes a folder holds, measured without stalling the server.
 *
 * The walk goes through an `FsLimiter` (../services/tree-purge.ts), the throttle the background
 * Agent purge uses: libuv's file I/O pool is shared by every file read the server makes and is
 * first in, first out, so a walk that queued every `lstat` of a big tree at once would hold up a
 * page's list behind all of them. Here at most `slots` calls of the walk are in flight across
 * every walk sharing the limiter, a directory's entries are measured a few lanes at a time, and
 * directories are entered one after another.
 *
 * What counts: the size of every file and of every link (as the link itself — a link is never
 * followed, so a link to `/` costs its own few bytes). Directories add no bytes of their own, so
 * the figure is the same on every filesystem. An entry that vanishes mid-walk, or that the
 * server may not read, counts as nothing and the walk goes on. `newestMs` is the newest
 * modification time seen anywhere in the tree, the folder itself included — what tells a folder
 * nobody has written for a day from one being filled right now.
 */
import fs from "node:fs/promises";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import type { FsLimiter } from "../services/tree-purge.js";

/** What a walk found: the bytes, and the newest modification time (ms; 0 when nothing was seen). */
export interface TreeSize {
  bytes: number;
  newestMs: number;
}

export interface MeasureOptions {
  limiter: FsLimiter;
  /** Ends the walk between calls: the measurement is thrown away (an AbortError rejects). */
  signal?: AbortSignal;
}

/** Entries of one directory measured side by side; the limiter still caps what actually runs. */
const ENTRY_LANES = 8;

const code = (err: unknown): string | undefined => (err as NodeJS.ErrnoException).code;

/** An empty measurement. */
export const NOTHING: TreeSize = { bytes: 0, newestMs: 0 };

/** Adds `b` into `a`. */
export function addSize(a: TreeSize, b: TreeSize): void {
  a.bytes += b.bytes;
  if (b.newestMs > a.newestMs) a.newestMs = b.newestMs;
}

function stopIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Aborted", "AbortError");
}

async function lstatOrNull(target: string, limiter: FsLimiter): Promise<Stats | null> {
  try {
    return await limiter.run(() => fs.lstat(target));
  } catch (err) {
    if (code(err) === "ENOENT" || code(err) === "EACCES" || code(err) === "EPERM") return null;
    throw err;
  }
}

/** A directory's entries; a directory that vanished or may not be read has none. */
export async function readEntries(dir: string, limiter: FsLimiter): Promise<Dirent[]> {
  try {
    return await limiter.run(() => fs.readdir(dir, { withFileTypes: true }));
  } catch (err) {
    const c = code(err);
    if (c === "ENOENT" || c === "ENOTDIR" || c === "EACCES" || c === "EPERM") return [];
    throw err;
  }
}

/** Runs `fn` over `items` with at most `width` in progress. */
export async function eachLimited<T>(
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

/** Measures what is under `dir` (its entries, not the directory itself). */
async function walkDir(dir: string, opts: MeasureOptions, into: TreeSize): Promise<void> {
  stopIfAborted(opts.signal);
  const entries = await readEntries(dir, opts.limiter);
  const dirs: string[] = [];
  await eachLimited(entries, ENTRY_LANES, async (entry) => {
    stopIfAborted(opts.signal);
    const full = path.join(dir, entry.name);
    const st = await lstatOrNull(full, opts.limiter);
    if (st === null) return;
    if (st.mtimeMs > into.newestMs) into.newestMs = st.mtimeMs;
    if (st.isDirectory()) dirs.push(full);
    else into.bytes += st.size;
  });
  // Directories one at a time, depth first: lanes per level would multiply with the depth.
  for (const sub of dirs) await walkDir(sub, opts, into);
}

/**
 * The bytes under `target` and its newest modification: a file's own size, a link's own size,
 * or everything under a directory. A missing target measures as nothing.
 */
export async function measureTree(target: string, opts: MeasureOptions): Promise<TreeSize> {
  stopIfAborted(opts.signal);
  const st = await lstatOrNull(target, opts.limiter);
  if (st === null) return { ...NOTHING };
  const size: TreeSize = { bytes: 0, newestMs: st.mtimeMs };
  if (!st.isDirectory()) {
    size.bytes = st.size;
    return size;
  }
  await walkDir(target, opts, size);
  return size;
}

/**
 * Each entry directly under `dir`, measured on its own — the folders a cleanup offers one by one
 * (a Session's scratchpad, a Workspace, an environment) — and their sum. A missing `dir` has none.
 */
export async function measureChildren(
  dir: string,
  opts: MeasureOptions,
): Promise<{ total: TreeSize; children: Map<string, TreeSize> }> {
  const total: TreeSize = { ...NOTHING };
  const children = new Map<string, TreeSize>();
  const own = await lstatOrNull(dir, opts.limiter);
  if (own === null || !own.isDirectory()) {
    if (own !== null) total.bytes = own.size;
    return { total, children };
  }
  total.newestMs = own.mtimeMs;
  for (const entry of await readEntries(dir, opts.limiter)) {
    const size = await measureTree(path.join(dir, entry.name), opts);
    children.set(entry.name, size);
    addSize(total, size);
  }
  return { total, children };
}
