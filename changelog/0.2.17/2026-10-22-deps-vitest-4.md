# Test runner: vitest 4 (vitest, @vitest/mocker and tinypool advisories)

- **Date:** 2026-10-22
- **Type:** fix
- **Scope:** `tooling`
- **PR:** [#1294](https://github.com/Prism-Shadow/penguin-harness/pull/1294)

[中文版](2026-10-22-deps-vitest-4.zh.md)

Moved every package's tests from vitest 3.2.7 to 4.1.12, closing the 22 open Dependabot alerts on the test runner: GHSA-82fw-gwwq-j7x9 (file read through a redirected mock; 18 alerts on the workspace's manifests, one on `@vitest/mocker`), GHSA-qxg6-89mg-rqv8 (`@vitest/mocker` manual-mock registration) and the two critical tinypool advisories GHSA-5gmw-xhrv-c9v3 and GHSA-85c8-ppgw-ccpr. No 3.x release carries the fixes. vitest 4 runs its own worker pool, so tinypool left the lockfile. All of it is development tooling; nothing shipped changed.

## Details

- `vitest` is `^4.1.12` in the root and in the sixteen packages and plugins that test with it; `@vitest/coverage-v8` is pinned to `4.1.12` in `core`, `server` and `web`, the exact version vitest requires of it.
- vitest 4 removed the `it(name, fn, options)` form. The two live-LLM tests in `packages/core/test/llm.e2e.test.ts` pass their timeout and retry options as the second argument; the old form failed the whole core suite at collection.
- The server's vitest config dropped `minWorkers`, which vitest 4 no longer has; `maxWorkers` alone sizes the pool. It had been set in [faster CI test jobs](2026-10-15-ci-faster-pipeline.md) to stop tinypool terminating idle workers.
- vitest 4 no longer brings `supports-color` into `packages/ui`'s dependency graph, which made pnpm hand `@prismshadow/penguin-ui` to `web`, `landing`, `docs` and `ui-gallery` as an injected copy, refreshed only by `pnpm install`, instead of a link to the live source. `packages/ui` declares `supports-color` as a devDependency, so the four packages link it as before; `pnpm-workspace.yaml` says why beside `injectWorkspacePackages`.
