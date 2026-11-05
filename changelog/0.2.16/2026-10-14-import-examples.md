# Import examples and file-based Benchmark imports

- **Date:** 2026-10-14
- **Type:** refactor
- **Scope:** `web`, `cli`, `server`, `docs`, `skills`, `ui-gallery`
- **PR:** [#1117](https://github.com/Prism-Shadow/penguin-harness/pull/1117)
- **Breaking:** yes — removed the `penguin benchmark import` command and its server upload helper export.

[中文版](2026-10-14-import-examples.zh.md)

Benchmark imports through an Agent now copy the manifest and case folders directly into the Project's `benchmarks/<id>/`, record the source and start an empty scoreboard.

## Import dialogs

- Added four Benchmark examples (Sec A, B, C and E) and four plugin examples (browser automation, data analysis, Humanizer and Bento Slides). Selecting an example fills the source for editing.
- Folded the full prompt by default and moved supporting explanations behind circled question marks. Shortened the Chinese and English copy.
- Kept plugin installation through `penguin plugin install` and zip uploads through the existing import dialogs.

## Compatibility

Replace `penguin benchmark import` calls with copying `benchmark_config.toml` and `CASE-*` folders into the target Project's `benchmarks/<id>/`, then creating `scoreboard.yaml` with `evaluations: []`. Confirm before replacing an existing directory and wait for active evaluations to finish. The updated `benchmark-design` Skill documents the file layout and origin fields.

The CLI-only `@prismshadow/penguin-server/benchmark-package` export was removed. Existing Benchmark files need no conversion.
