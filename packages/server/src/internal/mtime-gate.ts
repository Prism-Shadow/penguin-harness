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

/**
 * A gate-cacheable mtime: the real value once stable, else a sentinel that never matches.
 *
 * "Unstable" means the age is in (0, FRESH_MS]: a write may still be landing on the same
 * coarse tick, so the value must not yet be recorded as clean. A FUTURE mtime (negative
 * age — a restored backup, `rsync -t` from a faster host, NFS/container clock skew) is
 * not unstable, merely wrong: waiting can never make it comparable, and caching the
 * sentinel here would re-diff the whole tree on every pass until the wall clock catches
 * up — a wedge no quiet period settles. It is cached as its real value instead: any real
 * change moves the mtime off the cached one, so the gate still notices.
 */
export function cacheable(mtimeMs: number): number {
  const age = Date.now() - mtimeMs;
  return age > FRESH_MS || age < 0 ? mtimeMs : -1;
}

/** mtimeMs of a path; null when it does not exist. */
export async function statMtime(p: string): Promise<number | null> {
  try {
    return (await fs.stat(p)).mtimeMs;
  } catch {
    return null;
  }
}
