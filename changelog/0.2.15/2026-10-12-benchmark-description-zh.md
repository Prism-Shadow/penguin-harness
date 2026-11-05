# Benchmarks: a description in Chinese

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#1030](https://github.com/Prism-Shadow/penguin-harness/pull/1030)

[中文版](2026-10-12-benchmark-description-zh.zh.md)

`benchmark_config.toml` gained an optional `description_zh`, the description in Chinese, the way a plugin's `package.json` carries one: the server read and wrote it (same 2,000-character limit as `description`), the Benchmark API returned it as `descriptionZh`, and the Evaluation Center showed it instead of `description` in the Chinese interface, on the cards and the Benchmark page; search matched both. The five built-in Benchmarks and the example Benchmark carried one, their versions moving to `2026.10.12.1`; a Project keeps the copies it was created with. A manifest without the key read as before, and a release before this one ignored it.
