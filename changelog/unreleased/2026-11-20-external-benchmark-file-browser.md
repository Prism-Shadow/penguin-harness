# Benchmark files in external data repositories

- **Date:** 2026-11-20
- **Type:** fix
- **Scope:** `landing`
- **PR:** [#1663](https://github.com/Prism-Shadow/penguin-harness/pull/1663)

[中文版](2026-11-20-external-benchmark-file-browser.zh.md)

The Benchmarks page reads each task's instruction and file list from the data revision in its Case. File links open that same commit on GitHub.

## Details

The site reuses one sparse checkout per data revision and downloads only READMEs and instructions. The GDPevo article links to the migrated scenarios.
