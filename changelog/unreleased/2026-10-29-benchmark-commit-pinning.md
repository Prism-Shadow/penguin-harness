# Pin Benchmark evaluations to commits

- **Date:** 2026-10-29
- **Type:** fix
- **Scope:** `skills`

[中文版](2026-10-29-benchmark-commit-pinning.zh.md)

Agent Evaluation and Benchmark Design require Case instructions to name the task repository and a full commit. Task links, run rules and checkout instructions use that same commit, which is recorded with the evaluation. Display packages continue to be fetched from `main` through the existing build and import flows.
