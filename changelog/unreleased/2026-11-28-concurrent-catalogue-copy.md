# Copy a shipped Benchmark package with many files in flight

- **Date:** 2026-11-28
- **Type:** fix
- **PR:** [#1943](https://github.com/Prism-Shadow/penguin-harness/pull/1943)
- **Scope:** `core`

[中文版](2026-11-28-concurrent-catalogue-copy.zh.md)

Writing a built-in Benchmark package into a new Project now copies its files concurrently
instead of one after another. The shipped catalogue grew from hundreds to about 4,000 files, and
the sequential copy took over a second per Project (about 0.4 s now on Linux).
