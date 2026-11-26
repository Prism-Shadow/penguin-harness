# GDPEVO loads as Train/Test pairs for six domains

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `web`, `ui-gallery`, `landing`, `tooling`, `agent-evaluation`
- **PR:** [#1341](https://github.com/Prism-Shadow/penguin-harness/pull/1341)

[中文版](2026-10-26-gdpevo-domains.zh.md)

New Projects receive separate Train and Test Benchmarks for each of GDPEVO-CRM, GDPEVO-ERP, GDPEVO-Finance, GDPEVO-Healthcare, GDPEVO-Legal and GDPEVO-DataAnalysis. Each Train Benchmark has one continuous Case containing five training questions in one Agent Session and business container, with a six-hour solving limit and a Skill export. Each Test Benchmark has five independent Cases, each with a four-hour solving limit. Both use unlimited turns. The exported Skill is frozen before testing, and Train/Test scores are reported separately.

The twelve GDPEVO entries reuse the existing Benchmark structures, package format and provisioning. Test tasks use domain names such as `crm-test-001` directly under `tasks/`; training selects `train_tasks` in that same directory. English and Chinese descriptions explain each domain and split. The gallery, landing catalogue and import examples use the matching Train/Test IDs. Existing Project benchmarks are preserved, and the new GDPEVO entries start without evaluation records.

Built-in content now lives in the Benchmark repository's `packages/`. Builds fetch the manifests and each Case's two Markdown files from `main` and include them in npm packages, desktop installers and offline release bundles. Source builds cache the packages locally; `node scripts/build-benchmarks.mjs --refresh` refreshes them, and `PENGUIN_BENCHMARKS_SOURCE` selects a local packages directory when developing the two repositories together. Nothing is fetched at application startup or Project creation.

Harness copies the packaged manifest and Case files unchanged and creates an empty scoreboard. The hardcoded `builtin-benchmarks-data.ts`, statement/rubric generators and reverse package exporter are removed; the gallery reads a catalogue generated from the same packaged files. Case statements no longer repeat `summary`, `category`, `cpus` or `memoryMb`; Docker resource limits remain in the task files. Source links use `main` without a per-Benchmark `ref`. Agent Evaluation accepts branch, tag and commit links, resolving the source once per evaluation so every cell uses the same checkout.
