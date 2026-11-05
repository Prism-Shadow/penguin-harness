# Benchmark helper paths in Agent Evaluation

- **Date:** 2026-11-03
- **Type:** fix
- **Scope:** `skills`
- **PR:** [#1436](https://github.com/Prism-Shadow/penguin-harness/pull/1436)

[中文版](2026-11-03-benchmark-helper-paths.zh.md)

Updated the Harbor reference to take helper paths from the pinned benchmark README and the network overlay from the Case's launch, with install-bundle and model-host examples under `agents/`. Replaced the removed image-listing helper with direct pulls of the images named in each task's `task.toml`.
