/**
 * Vitest config for the server: platform-aware deadlines, and a shared module registry.
 *
 * The deadlines mirror core's rationale: these tests build full app instances over real
 * SQLite files and Agent State trees, and the Windows CI runners' I/O variance (Defender
 * first-touch scans, slow handle release) pushes individually fast tests and cleanup hooks
 * past the 5s/10s defaults — a different file on each run. Larger deadlines change nothing
 * for passing tests; POSIX keeps the defaults to fail fast during local development. The
 * hook timeout matters here specifically: `cleanup()` removes the whole test root, and on
 * win32 that rm can legitimately take retries (see helpers.ts). POSIX is deliberately left
 * at the default: a hook that blows this deadline on macOS has so far meant a test leaking
 * an open connection into `server.close()`, which a larger number only delays.
 *
 * `isolate: false` lets a worker reuse its module registry across the files it runs instead
 * of discarding it after each one. Every file here imports the whole app graph, core's
 * bundle included, so evaluating that graph once per file rather than once per worker
 * dominated the suite's wall clock; sharing it also drops fork spawns from one per file to
 * one per worker, which is worth more on the Windows runner than anywhere else.
 * What makes it safe: no file in this suite mocks a module — `vi.mock` would leak into
 * every later file in the same fork, which `test/isolation.test.ts` guards against — the
 * few that mutate `process.env` save and restore it, and files inside a worker still run
 * one at a time. The pool stays `forks` for that last reason: `process.env` is per-process,
 * so a thread pool would let those env-mutating files race each other.
 *
 * `retry` on win32 mirrors core's: real SQLite files and full app trees against a runner
 * whose I/O stalls at a measurable rate, retried per test rather than by re-running the
 * job. Linux keeps 0. What it does NOT cover is a failure with no failing test — a pool
 * teardown crash — which ci.yml absorbs with one retry of the whole command instead.
 *
 * macOS is retried once too: terminal-stream.test.ts drives a real pty and asserts on what
 * came back through it, and that assertion has lost the race on the macOS runner. A retry
 * only rescues a test whose attempts are independent, which constrains what a retried file
 * may read from its own file scope: a test that consults an accumulator an earlier attempt
 * appended to retries into a different — and certain — failure.
 *
 * `restoreMocks` makes the spy half of that mechanical rather than a reading of the suite:
 * a `vi.spyOn` whose inline `mockRestore()` is skipped by a failing assertion above it
 * would otherwise stay installed for every later file in the same worker.
 *
 * `--shard` deals files by their measured Windows durations rather than by a hash of the path
 * (test/setup/weighted-shards.ts, weights in test/shard-weights.json).
 */
import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
import { WeightedShards } from "./test/setup/weighted-shards";

/**
 * Workers: one per core on macOS, at most four; two elsewhere. Each worker boots app trees and
 * runs real TypeScript compilers, so the count that pays is the number of physical cores. The
 * macOS runner's three vCPUs are three cores: three workers ran the suite there in 96 s (two:
 * 114–171 s). The Linux and Windows runners' four vCPUs are two cores with two threads each:
 * four workers on Linux doubled the summed test time (226 → 465 s) for no shorter run, and a
 * third on Windows nearly doubled every file's time for no shorter shard. `availableParallelism`
 * counts threads, not cores, which is why it is consulted only where the two are the same.
 *
 * `minWorkers` equals `maxWorkers` because with `isolate: false` a worker above the minimum is
 * terminated while idle, and that termination can reject inside tinypool after every file has
 * passed ("Terminating worker thread"), failing the run with no failing test. Three workers over
 * a minimum of one did so on every run on a four-core machine; equal counts were not seen to.
 */
const WORKERS =
  process.platform === "darwin" ? Math.max(1, Math.min(4, availableParallelism())) : 2;

export default defineConfig({
  test: {
    environment: "node",
    maxWorkers: WORKERS,
    minWorkers: WORKERS,
    sequence: { sequencer: WeightedShards },
    isolate: false,
    restoreMocks: true,
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
    retry: process.platform === "win32" ? 2 : process.platform === "darwin" ? 1 : 0,
    // Everything a run writes under the OS temp directory stays in one directory of its own,
    // which teardown reports on and removes; every file sweeps the temp roots it was handed.
    globalSetup: ["test/setup/run-temp-dir.ts"],
    setupFiles: ["test/setup/temp-roots.ts"],
    // `vitest run --coverage` maps every file under src/, loaded by a test or not.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // CI uploads these even after a failure; preserve the diagnostics for that run.
      reportOnFailure: true,
    },
  },
});
