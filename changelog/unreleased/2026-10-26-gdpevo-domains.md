# GDPEVO loads as six independent domain benchmarks

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `web`, `ui-gallery`, `tooling`
- **PR:** [#1341](https://github.com/Prism-Shadow/penguin-harness/pull/1341)

[中文版](2026-10-26-gdpevo-domains.zh.md)

New Projects received GDPEVO-CRM, GDPEVO-ERP, GDPEVO-Finance, GDPEVO-Healthcare, GDPEVO-Legal and GDPEVO-DataAnalysis through the existing built-in benchmark provisioning. Each domain carried one case with a short statement and rubric referencing the benchmark repository's `main` branch. The old cross-domain Train/Test definitions and their pinned task summaries were removed.

GDPEVO started without evaluation records. Training and test scores remained separate. Existing Project benchmarks were left in place, and Sec A–E retained their content and calibrated references. The shared package exporter wrote the same six domain definitions.
