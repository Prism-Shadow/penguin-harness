/**
 * Vitest config for the server: platform-aware deadlines, and a shared module registry.
 *
 * The deadlines mirror core's rationale: these tests build full app instances over real
 * SQLite files and Agent State trees, and the Windows CI runners' I/O variance (Defender
 * first-touch scans, slow handle release) pushes individually fast tests and cleanup hooks
 * past the 5s/10s defaults — a different file on each run. Larger deadlines change nothing
 * for passing tests; POSIX keeps the defaults to fail fast during local development. The
 * hook timeout matters here specifically: `cleanup()` removes the whole test root, and on
 * win32 that rm can legitimately take retries (see helpers.ts).
 *
 * `isolate: false` lets a worker reuse its module registry across the files it runs instead
 * of discarding it after each one. Every file here imports the whole app graph, core's
 * bundle included, so evaluating that graph once per file rather than once per worker
 * dominated the suite's wall clock; sharing it also drops fork spawns from one per file to
 * one per worker, which is worth more on the two-core Windows runner than anywhere else.
 * What makes it safe: no file in this suite mocks a module — `vi.mock` would leak into
 * every later file in the same fork, which `test/isolation.test.ts` guards against — the
 * few that mutate `process.env` save and restore it, and files inside a worker still run
 * one at a time. The pool stays `forks` for that last reason: `process.env` is per-process,
 * so a thread pool would let those env-mutating files race each other.
 *
 * `restoreMocks` makes the spy half of that mechanical rather than a reading of the suite:
 * a `vi.spyOn` whose inline `mockRestore()` is skipped by a failing assertion above it
 * would otherwise stay installed for every later file in the same worker.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    isolate: false,
    restoreMocks: true,
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
  },
});
