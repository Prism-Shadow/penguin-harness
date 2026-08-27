# CI runs as parallel shards instead of one serial job per platform

- **Date:** 2026-08-27
- **Type:** process
- **Scope:** `ci`, `tooling`
- **PR:** [#488](https://github.com/Prism-Shadow/penguin-harness/pull/488)

[中文版](2026-08-27-ci-parallel-gates.zh.md)

CI ran build, style, typecheck, test, installer and e2e as six serial steps inside one job per
platform, so every platform paid for every gate in sequence and the slowest job set the run's
length — 254s, of which the longest job spent 138s in vitest and 35s building all nine packages,
most of which that job never loaded. Each gate is now its own job and the unit suite is sharded
by package.

## Details

- Every job builds only the packages its shard loads. That is measured rather than derived from
  the dependency graph: the server shards build `@prismshadow/penguin-core...` and not
  `@prismshadow/penguin-server...`, which would drag in web because the server package ships
  `web-dist` that its tests never read.
- Coverage is unchanged. Every package's tests run exactly once per platform, and the shard sets
  each sum to the repository's 297 test files.
- Windows splits the core and server suites across vitest shards on top of the per-package split,
  because setup alone costs 55–81s there before a test runs. ubuntu and macOS keep whole suites.
- The Windows installer checks move out of the test matrix into their own job; they were riding
  the longest shard and adding 20s to the critical path.
- pnpm comes from corepack rather than `pnpm/action-setup`, with the tarball corepack fetches
  cached on the `packageManager` pin.
- `ci` becomes an aggregate job gated on every other one, so branch protection has one name to
  require that survives the shard list changing.
- The `style` job runs `actionlint` over every workflow. A workflow that does not parse produces
  a run with zero jobs and leaves no annotation on the run, the check suite or the commit status.

## Flaky tests

- `retry` in core's and the server's vitest configs: two attempts on Windows, one on macOS, none
  on Linux. Those suites spawn real shells and drive real ptys under deadlines, and the two
  runners lose those races at a measurable rate — one batch of reruns failed four Windows
  attempts in a row and then passed twice, on four different tests, from a change that could not
  affect behaviour. A retry costs nothing when everything passes, and a real regression still
  fails every attempt.
- A failure with no failing test — a tinypool `ERR_IPC_CHANNEL_CLOSED` raised while the worker
  pool tears down, after every file has reported green — is outside what a per-test retry can
  reach, so the Windows test step retries its whole command once and warns when it does.
- `dangerouslyIgnoreUnhandledErrors` would have silenced the teardown crash for nothing, and
  would have silenced a genuine Windows-only unhandled rejection with it. It is not used.
