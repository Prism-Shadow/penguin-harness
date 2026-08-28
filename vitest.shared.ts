/**
 * How much of the machine a test run is allowed to take.
 *
 * Two multipliers used to compound. `pnpm -r test` runs the workspace's packages
 * concurrently (pnpm's default is 4 at a time), and each package's vitest then opens a pool
 * of its own sized from the CPU count (vitest's default is `cores - 1`). On an 8-core host
 * that is up to 28 forks, and they are not small: the server suite runs with `isolate:
 * false`, so every fork holds the whole app graph — server, core, SQLite — resident for as
 * long as it lives. A developer's own PenguinHarness server, or anyone else's work on a
 * shared host, is then competing with a test run for the last of the memory, and the kernel
 * picks the loser.
 *
 * So the run takes half the machine and leaves the other half alone. The package axis is
 * pinned to one at a time in the root `test` script, and this is the other axis: half the
 * available cores, never fewer than one. Bounding only one of the two is not enough — they
 * multiply.
 *
 * `VITEST_MAX_FORKS` overrides it for a machine that is genuinely idle (a CI runner, a
 * laptop with nothing else on it), where the whole point is to use everything there is.
 */
import os from "node:os";

/** The pool bound, resolved once per config load. */
export function maxForks(): number {
  const override = Number(process.env.VITEST_MAX_FORKS);
  if (Number.isInteger(override) && override > 0) return override;
  // `availableParallelism` and not `cpus().length`: inside a container it reports the share
  // this process may actually use, which is the number the bound is about.
  return Math.max(1, Math.floor(os.availableParallelism() / 2));
}

/**
 * The pool settings every package's vitest config spreads in. `forks` rather than threads is
 * each config's own decision (the server suite needs a per-process `process.env`); this only
 * says how many of whatever pool it chose may exist at once.
 */
export const boundedPool = {
  maxWorkers: maxForks(),
  poolOptions: { forks: { maxForks: maxForks() }, threads: { maxThreads: maxForks() } },
} as const;
