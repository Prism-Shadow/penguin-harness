# SkillAdam RSI toolkit

- **Date:** 2026-10-28
- **Type:** feature
- **Scope:** `skills`
- **PR:** [#1374](https://github.com/Prism-Shadow/penguin-harness/pull/1374)

[中文版](2026-10-28-skilladam-rsi-toolkit.zh.md)

Added `skilladam-rsi-toolkit` to the plugin library. A controller Penguin reads the selected Project Benchmarks, arranges continuous training, and evaluates frozen Skills on held-out tasks.

## Details

Reports use shared `baseline`/`final`, repetition, version, score and resource field names. Keep method-specific learning records separate from repeated Test statistics.

Training progress uses numbered `step` labels and retains native stage names for traceability.

Plugin packages omit development test files.

The website algorithm catalog includes SkillAdam, Evo-Harness, OpenSkill and TRACE.

- Added learner instructions for initial Skill generation, an evolving issue tracker, a variance-controlled edit budget, and candidate evaluation.
- Added a numerical helper for optimizer state and Evaluation Center records.
- Added a train-once protocol with three test repetitions of each frozen State by default and separate Train/Test results. Aggregate cases within each repetition before calculating the mean and sample standard deviation; aggregate benchmarks in the same order.
- Required pre-training baseline and final Test scores. Reports identify experiment and component versions, retain the measured training curve, and record cost, time and tokens per learned Skill and per test-case repetition, with separate Train/Test totals. Token records distinguish cached input, uncached input and output, with input and overall totals.
