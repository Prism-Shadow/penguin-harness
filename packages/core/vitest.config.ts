/**
 * Vitest config for core. The one non-default setting is a platform-aware test timeout:
 * many core tests spawn a real shell (Git-Bash on the Windows CI runners) or write the
 * full Agent State layout, and Windows runner I/O variance (cold shell spawns, Defender
 * first-touch scans, slow-disk moments) has pushed individually fast tests past vitest's
 * 5s default — a different test on each run.
 *
 * The deadline's first sizing (30s) turned out to be inside that variance tail: on one
 * cold runner (PR #66's merge-ref run) the suite-start burst of first spawns across
 * parallel workers put environment.test.ts's single-spawn write at 28.1s PASSING and
 * engine.test.ts's first test at 35.7s FAILING, while runs of the same code minutes
 * before and after finished the failing test in ~1.4s. The slowdown tracked OS work
 * only — pure-JS test files stayed at normal speed in the same run — so the flow
 * terminates and merely waits on the OS. Amplification confirms it: injecting spawn
 * latency into the same test (a PENGUIN_SHELL shim sleeping before bash) reproduces the
 * failure exactly at 30s injected vs the old 30s deadline, with the flow completing
 * ~70ms after the spawn at every magnitude tried — tool latency flows through 1:1, the
 * loop adds no waits of its own (pinned platform-neutrally by the "slow tool delays the
 * run only by its own latency" test in test/engine.test.ts). 120s clears the observed
 * tail with headroom while still bounding a genuinely hung test.
 *
 * A larger failure deadline changes nothing for passing tests; POSIX keeps the 5s
 * default to fail fast during local development.
 *
 * `retry` on win32: the suites here spawn real shells and read their output under
 * deadlines, and the Windows runners lose those races at a measurable rate — over one
 * batch of reruns the Windows shard failed 4 attempts in a row and then passed twice, on
 * four DIFFERENT tests, from a diff that could not change behaviour at all. Retrying the
 * individual test costs nothing when everything passes and rescues the runs that would
 * otherwise be re-triggered by hand; a real regression fails all three attempts. POSIX
 * keeps 0 so a flake introduced there is seen the first time.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    testTimeout: process.platform === "win32" ? 120_000 : 5_000,
    retry: process.platform === "win32" ? 2 : process.platform === "darwin" ? 1 : 0,
  },
});
