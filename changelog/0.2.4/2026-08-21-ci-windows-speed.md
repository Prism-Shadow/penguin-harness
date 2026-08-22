# Split the Windows CI job into two test shards

- **Date:** 2026-08-21
- **Type:** process
- **Scope:** `ci`
- **PR:** [#385](https://github.com/Prism-Shadow/penguin-harness/pull/385)

[中文版](2026-08-21-ci-windows-speed.zh.md)

Split `ci-windows` into two parallel shards and dropped the steps that duplicated platform-independent gates, cutting the Windows wall clock roughly in half while every package's tests still run exactly once on Windows.

## Details

- The `server` shard runs the server package's suite alone — the process-heaviest suite gets the whole runner to itself — and carries the PowerShell installer parse and the Windows installer tests.
- The `packages` shard runs core's suite alone first (its `exec_command` tests spawn real shells under timeouts and lose races on an oversubscribed runner), then the remaining six packages together.
- Dropped the Windows `typecheck` step: tsc's result is platform-independent and the ubuntu job gates it — the reasoning the job already applied to `format:check`.
