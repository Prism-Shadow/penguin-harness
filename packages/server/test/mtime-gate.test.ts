/**
 * The mtime-gate contract every derived cache shares (see src/internal/mtime-gate.ts):
 * a quiet mtime is cacheable as its real value, a young one is not (same-tick change
 * hazard), and a FUTURE one is cacheable too — it is not unstable, merely wrong, and
 * caching the sentinel for it would wedge the gate into a full scan per request until
 * the wall clock catches up.
 */
import { describe, expect, it } from "vitest";
import { cacheable, FRESH_MS } from "../src/internal/mtime-gate.js";

describe("mtime-gate", () => {
  it("caches a quiet mtime as its real value and a young one as the never-matching sentinel", () => {
    const quiet = Date.now() - FRESH_MS * 10;
    expect(cacheable(quiet)).toBe(quiet);
    expect(cacheable(Date.now())).toBe(-1);
    expect(cacheable(Date.now() - FRESH_MS / 2)).toBe(-1);
  });

  it("caches a FUTURE mtime as its real value, not the sentinel (a skewed dir must not wedge the gate)", () => {
    // Restored backup / rsync -t from a faster host / NFS or container clock skew. A
    // negative age is not "younger than FRESH_MS": it can never expire into a match, so
    // the sentinel would force a full re-diff on every pass, re-caching itself each time.
    const future = Date.now() + 60 * 60 * 1000;
    expect(cacheable(future)).toBe(future);
  });
});
