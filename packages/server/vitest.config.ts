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
 * few that mutate `process.env` save and restore it (TZ through test/helpers/time-zone.ts:
 * deleting TZ does not move a Windows process back to its own zone), and files inside a worker
 * still run one at a time. The pool stays `forks` for that last reason: `process.env` is
 * per-process, so a thread pool would let those env-mutating files race each other.
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
import { fileURLToPath } from "node:url";
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
 * `maxWorkers` is the only worker knob: vitest 4 replaced tinypool with its own pool and dropped
 * `minWorkers`, which under vitest 3 kept tinypool from terminating an idle worker and failing a
 * run after every file had passed.
 */
const WORKERS =
  process.platform === "darwin" ? Math.max(1, Math.min(4, availableParallelism())) : 2;

export default defineConfig({
  // The browser suites that boot the App load the browser-automation plugin from its sources
  // (test/builtin-browser/plugin.ts), which reach this package through its published face; a
  // package cannot resolve its own name, so the two subpaths point at their sources. The
  // workspace packages point at their sources for a different reason: each ships to this
  // package as an injected snapshot — a file: copy under .pnpm, not a symlink into its
  // sources — so left to node resolution, their dist runs under the raw Node loader beside
  // the run's module graph, and every workspace package they import is a second physical
  // copy under .pnpm too. Shared state and identity then split in two: the plugin library
  // host the setup file names (test/setup/library-host.ts) is invisible to that copy, the
  // fixture libraries the tests push are invisible to the library the routes hold, and the
  // error classes the routes catch never match the instances the library throws. Pointing
  // the imports at the sources keeps the whole domain — the libraries, core, and hmr's
  // manifest — on the run's one module graph, where the symlinked workspace packages
  // already are. core's two non-mirroring subpaths are pinned to their files before the
  // bare name: the entries match in order, and the bare name would otherwise swallow them
  // into src/plugin-index and src/model-connection, which do not exist.
  resolve: {
    alias: {
      "@prismshadow/penguin-server/plugin": fileURLToPath(
        new URL("./src/plugin/index.ts", import.meta.url),
      ),
      "@prismshadow/penguin-server/api": fileURLToPath(
        new URL("./src/api/types.ts", import.meta.url),
      ),
      "@prismshadow/penguin-core/plugin-index": fileURLToPath(
        new URL("../../packages/core/src/plugin/index-document.ts", import.meta.url),
      ),
      "@prismshadow/penguin-core/model-connection": fileURLToPath(
        new URL("../../packages/core/src/state/model-connection.ts", import.meta.url),
      ),
      "@prismshadow/penguin-core": fileURLToPath(
        new URL("../../packages/core/src", import.meta.url),
      ),
      "@prismshadow/penguin-hmr": fileURLToPath(
        new URL("../../packages/hmr/src", import.meta.url),
      ),
      // The theme-pack and the UI package have non-mirroring subpaths too (entries before the
      // bare names, for the same reason core's are); left to node resolution their snapshot
      // copies would run beside the graph's own, splitting the ThemePackError the settings
      // group's routes catch from the instance the validator throws.
      "@prismshadow/penguin-ui/chat-markdown": fileURLToPath(
        new URL("../../packages/ui/src/markdown/index.ts", import.meta.url),
      ),
      "@prismshadow/penguin-ui/pack-rules": fileURLToPath(
        new URL("../../packages/ui/src/testing/pack-rules.ts", import.meta.url),
      ),
      "@prismshadow/penguin-ui": fileURLToPath(
        new URL("../../packages/ui/src", import.meta.url),
      ),
      "@prismshadow/penguin-theme-pack": fileURLToPath(
        new URL("../../packages/theme-pack/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-agent": fileURLToPath(
        new URL("../../library/agent/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-agent-api": fileURLToPath(
        new URL("../../library/agent-api/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-auth": fileURLToPath(
        new URL("../../library/auth/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-benchmark": fileURLToPath(
        new URL("../../library/benchmark/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-cli": fileURLToPath(
        new URL("../../library/cli/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-db": fileURLToPath(
        new URL("../../library/db/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-http": fileURLToPath(
        new URL("../../library/http/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-machine": fileURLToPath(
        new URL("../../library/machine/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-messaging": fileURLToPath(
        new URL("../../library/messaging/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-model": fileURLToPath(
        new URL("../../library/model/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-observability": fileURLToPath(
        new URL("../../library/observability/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-organization": fileURLToPath(
        new URL("../../library/organization/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-plugin": fileURLToPath(
        new URL("../../library/plugin/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-project": fileURLToPath(
        new URL("../../library/project/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-session": fileURLToPath(
        new URL("../../library/session/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-setting": fileURLToPath(
        new URL("../../library/setting/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-trace": fileURLToPath(
        new URL("../../library/trace/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-workbench": fileURLToPath(
        new URL("../../library/workbench/src", import.meta.url),
      ),
      "@prismshadow/penguin-library-workspace": fileURLToPath(
        new URL("../../library/workspace/src", import.meta.url),
      ),
    },
  },
  test: {
    server: {
      deps: {
        // The setting domain library (an externalized node_modules package) imports the
        // theme-pack and the UI package's pack rules, whose package exports are TypeScript
        // sources; left external, the run's Node loader reaches them and refuses the
        // extension. Inlining the libraries lets vite transform the chain the way it
        // transforms this package's own imports.
        inline: [
          /@prismshadow\/penguin-library-setting/,
          /@prismshadow\/penguin-theme-pack/,
          /@prismshadow\/penguin-ui/,
        ],
      },
    },
    environment: "node",
    maxWorkers: WORKERS,
    sequence: { sequencer: WeightedShards },
    isolate: false,
    restoreMocks: true,
    testTimeout: process.platform === "win32" ? 30_000 : 5_000,
    hookTimeout: process.platform === "win32" ? 30_000 : 10_000,
    retry: process.platform === "win32" ? 2 : process.platform === "darwin" ? 1 : 0,
    // Everything a run writes under the OS temp directory stays in one directory of its own,
    // which teardown reports on and removes; every file sweeps the temp roots it was handed.
    globalSetup: ["test/setup/run-temp-dir.ts"],
    setupFiles: ["test/setup/temp-roots.ts", "test/setup/library-host.ts"],
    // `vitest run --coverage` maps every file under src/, loaded by a test or not.
    coverage: {
      provider: "v8",
      include: ["src/**"],
      // CI uploads these even after a failure; preserve the diagnostics for that run.
      reportOnFailure: true,
    },
  },
});
