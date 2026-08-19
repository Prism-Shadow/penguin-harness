# data-analysis skill v2 and a leaner multi-run evaluation flow

- **Date:** 2026-08-04
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#194](https://github.com/Prism-Shadow/penguin-harness/pull/194)

[中文版](2026-08-04-data-analysis-skill-v2.zh.md)

The `data-analysis` library skill moves to v2, tightening its constraints on data granularity and semantics, native artifact handling, complete delivery, and risk-proportional verification. The benchmark flow stops re-running what it already measured: the design stage pins every Case at one run and reuses the selected Pilot results verbatim as the Formal Baseline, the Optimization stage takes a user-specified per-Candidate `runs` count dispatched Case × Runs in parallel and compares the recorded averages directly, and the Evaluator treats `run` as an upstream-assigned label instead of rejecting runs beyond the config's total. Docs (zh/en), the frontend example prompts and the contract tests are updated in sync.
