# Pin Benchmark builds and evaluations to commits

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `core`, `build`, `skills`

[中文版](2026-10-29-benchmark-commit-pinning.zh.md)

Benchmark packages are bundled from a fixed repository commit, and changing the pin refreshes the build cache. Packages still contain only manifests and Case Markdown.

The manifest’s `ref` records the task-source commit and survives package import/export. Harbor evaluation and Benchmark design require full commit links; the task, run rules and checkout must agree with the declared revision. Import provenance remains in `[origin]`.
