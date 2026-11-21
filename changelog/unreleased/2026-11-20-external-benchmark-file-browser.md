# Benchmark files in external data repositories

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1663](https://github.com/Prism-Shadow/penguin-harness/pull/1663)

[中文版](2026-11-20-external-benchmark-file-browser.zh.md)

The Benchmarks page uses each package’s `data_url` to find its data repository. The task file browser shows the repository’s default branch.

## Details

Packages that share a repository reuse one sparse checkout. The GDPevo article links to the migrated scenarios.
