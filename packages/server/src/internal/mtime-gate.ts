/**
 * Shared mtime-gate primitives for the server's derived caches (Trace index, schedule
 * scans, project-config reads): disk stays the single source of truth, and a cached
 * value may be served only while the stat'd mtime still matches the one recorded at
 * read time. External edits are therefore caught by one stat instead of a re-read.
 *
 * The freshness guard is the subtle part of the contract: filesystem timestamps are
 * coarse (a write and a later change can land on the same tick), so an mtime younger
 * than FRESH_MS is never recorded as clean — `cacheable` returns a sentinel that can
 * never match a real stat, forcing re-reads until the path has been quiet. An mtime
 * in the future is clock skew (a restore, `rsync -t`, NTP), not a just-written path,
 * and is recorded as-is so the gate cannot wedge until the wall clock catches up.
 * Every gate in the server must go through these helpers so the contract stays in
 * one place.
 */
import fs from "node:fs/promises";

/**
 * mtimes younger than this are treated as UNSTABLE and never cached as clean: an
 * actively-written path costs one extra re-read per pass, and a gate can never wedge
 * on a same-tick change. Future mtimes are not "young" — they are skew — and stay
 * cacheable.
 */
export const FRESH_MS = 2000;

/** A gate-cacheable mtime: the real value once stable (including skewed clocks), else a sentinel that never matches. */
export function cacheable(mtimeMs: number): number {
  const age = Date.now() - mtimeMs;
  // A negative age is a future timestamp. Recording the -1 sentinel would never
  // match a later stat of the same path, so every pass would re-read until the
  // wall clock passed the recorded mtime.
  if (age < 0) return mtimeMs;
  return age > FRESH_MS ? mtimeMs : -1;
}

/** mtimeMs of a path; null when it does not exist. */
export async function statMtime(p: string): Promise<number | null> {
  try {
    return (await fs.stat(p)).mtimeMs;
  } catch {
    return null;
  }
}
