# A test run takes half the machine, not all of it

- **Date:** 2026-08-28
- **Type:** fix
- **Scope:** `tooling`

[中文版](2026-08-28-vitest-concurrency.zh.md)

`pnpm test` could open up to 28 heavy Node processes on an 8-core host, and did: two concurrency limits multiplied. `pnpm -r` runs the workspace's packages four at a time by default, and each package's vitest then sized its own pool from the CPU count — vitest's default is `cores - 1`. The forks are not small either. The server suite runs with `isolate: false`, so each of its forks holds the whole app graph — server, core, SQLite — resident for as long as it lives.

The result is a test run that competes with everything else on the host for the last of the memory. On a developer's own machine that is their PenguinHarness server; on a shared one it is somebody else's work. Either way the kernel picks the loser, and it is not the test run.

Both axes are bounded now, because bounding one is not enough — they multiply:

- Packages run **one at a time** (`--workspace-concurrency=1` on the root `test` script).
- Each pool takes **half the available cores**, never fewer than one (`vitest.shared.ts`, spread into every package's vitest config).

`availableParallelism()` rather than the raw CPU count: inside a container it reports the share this process may actually use, which is the number the bound is about. `VITEST_MAX_FORKS` overrides it for a machine that is genuinely idle — a CI runner, or a laptop with nothing else on it — where using everything there is is the point.

Running one package's tests directly (`pnpm --filter … test`) is unchanged apart from the pool bound.
