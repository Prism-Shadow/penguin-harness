# Pin Benchmark evaluations to commits

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `core`, `skills`

[中文版](2026-10-29-benchmark-commit-pinning.zh.md)

The manifest’s `ref` records the task-source commit and survives package import/export. Harbor evaluation and Benchmark design require full commit links; the task, run rules and checkout must agree with the declared revision. Import provenance remains in `[origin]`.
