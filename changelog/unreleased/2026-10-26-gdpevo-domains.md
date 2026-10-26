# GDPEVO loads as six independent domain benchmarks

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `web`, `ui-gallery`, `tooling`
- **PR:** [#1341](https://github.com/Prism-Shadow/penguin-harness/pull/1341)

[中文版](2026-10-26-gdpevo-domains.zh.md)

New Projects received GDPEVO-CRM, GDPEVO-ERP, GDPEVO-Finance, GDPEVO-Healthcare, GDPEVO-Legal and GDPEVO-DataAnalysis through the existing built-in benchmark provisioning. Each domain used the existing benchmark and case structures for its five test tasks, with optional metadata omitted and links to the benchmark repository's `main` branch. Test tasks used domain names such as `crm-test-001` directly under `tasks/`, reusing the existing case-name and task-path handling. A short note linked the domain README for continuous training and frozen-Agent testing. The old cross-domain Train/Test definitions and fixed GDPEVO revision were removed.

GDPEVO started without evaluation records. Training and test scores remained separate. All built-in benchmarks used the benchmark repository's `main` branch for links and checkout instructions; the per-benchmark `ref` field and fixed source commits were removed. Existing Project benchmarks were left in place. The shared package exporter wrote the same definitions.
