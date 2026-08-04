/**
 * Shared mtime-gate primitives for the server's derived caches (Trace index, schedule
 * scans, project-config reads): disk stays the single source of truth, and a cached
 * value may be served only while the stat'd mtime still matches the one recorded at
 * read time. External edits are therefore caught by one stat instead of a re-read.
 *
 * The freshness guard is the subtle part of the contract: filesystem timestamps are
 * coarse (a write and a later change can land on the same tick), so an mtime younger
 * than FRESH_MS is never recorded as clean — `cacheable` returns a sentinel that can
 * never match a real stat, forcing re-reads until the path has been quiet. Every gate
 * in the server must go through these helpers so the contract stays in one place.
 */
import fs from "node:fs/promises";

/**
 * mtimes younger than this are treated as UNSTABLE and never cached as clean: an
 * actively-written path costs one extra re-read per pass, and a gate can never wedge
 * on a same-tick change.
 */
export const FRESH_MS = 2000;

/** A gate-cacheable mtime: the real value once stable, else a sentinel that never matches. */
export function cacheable(mtimeMs: number): number {
  return Date.now() - mtimeMs > FRESH_MS ? mtimeMs : -1;
}

/** mtimeMs of a path; null when it does not exist. */
export async function statMtime(p: string): Promise<number | null> {
  try {
    return (await fs.stat(p)).mtimeMs;
  } catch {
    return null;
  }
}
