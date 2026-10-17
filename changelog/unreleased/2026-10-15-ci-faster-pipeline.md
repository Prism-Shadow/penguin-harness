# Faster CI test jobs and a fixed server worker pool

- **Date:** 2026-10-15
- **Type:** process
- **Scope:** `ci`, `server`, `skills`
- **PR:** [#1158](https://github.com/Prism-Shadow/penguin-harness/pull/1158)

[中文版](2026-10-15-ci-faster-pipeline.zh.md)

Shortened the CI test jobs and removed a way for the server suite to fail with every test passing.

## Details

- The Linux, macOS and Windows test jobs build the server without its type declarations (`PENGUIN_BUILD_JS_ONLY=1`), which no test reads; the typecheck and npm packaging jobs still build them.
- The Windows server shards no longer regenerate the interface table the setup step's server build has just written.
- A full run tests the browser and site packages (`web`, `ui`, `ui-gallery`, `docs`, `landing`) on macOS and Windows in a `sites` shard of its own instead of inside `rest`.
- The runtime jobs keep electron-builder's downloads in the Actions cache.
- The server's Vitest pool keeps its two workers with `minWorkers` equal to `maxWorkers`. A worker above the minimum was terminated while idle, which can fail the run with "Terminating worker thread" after every file has passed.
- The `penguin-harness-dev` skill has a section on CI time as a cost: per-test budgets on the Windows runner, fixture size, shared setup, the cost of a new shard, and checking a PR's job durations.
