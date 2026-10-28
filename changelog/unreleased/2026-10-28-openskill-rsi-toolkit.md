# OpenSkill RSI toolkit

- **Date:** 2026-10-28
- **Type:** feature
- **Scope:** `skills`
- **PR:** [Saigyouji-Yuyuko1000/penguin-harness#4](https://github.com/Saigyouji-Yuyuko1000/penguin-harness/pull/4)

[中文版](2026-10-28-openskill-rsi-toolkit.zh.md)

Added `openskill-rsi-toolkit` for constructing reusable Skills through external research and independent virtual verification, then evaluating the frozen library on Project Benchmarks.

Registered the plugin in core, CLI and desktop package dependencies and in the English and Chinese plugin catalogs.

Removed the development acceptance suite and replay tools, along with the Skill's requirement to run them before an experiment.

## Experiment records

Construct one library per training unit, then evaluate the baseline and final States three complete times by default. Reports record experiment and component versions, repetition-level means and sample standard deviations, and measured cost, time and token categories per training unit and test attempt.

Reports use shared `baseline`/`final`, repetition, version, score and resource field names. Keep method-specific learning records separate from repeated Test statistics.

Training progress uses numbered `step` labels and retains native stage names for traceability.

OpenSkill retains virtual validation curves separately from Benchmark Train scores. Construction remains closed before target scoring; the final library is the last revision.
