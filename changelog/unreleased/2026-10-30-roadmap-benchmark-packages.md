# Support Benchmark package metadata and task configuration

- **Date:** 2026-10-30
- **Type:** feature
- **Scope:** `core`, `web`, `landing`, `docs`, `tooling`, `plugins`
- **PR:** [#1401](https://github.com/Prism-Shadow/penguin-harness/pull/1401)

[中文版](2026-10-30-roadmap-benchmark-packages.zh.md)

Added support for `x.y.z` Benchmark package versions while retaining support for existing date versions. Imports and saves preserved the package's author, update timestamp and Chinese title. Builds included each Case's `task_config.toml` alongside its Statement and Rubric, without bundling task data or environments. Documented the shared package metadata and task layout for Sec A–E and GDPEVO Essential, including the Benchmark Design Skill's import reference.

Updated the import example, README and Evaluation Center documentation for GDPEVO Essential and its continuous training workflow. Removed the landing page's duplicate package ID list and kept its catalogue check against the packages' upstream sources.
