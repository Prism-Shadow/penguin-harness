# Isolated Agent tuning pipeline

- **Date:** 2026-07-25
- **Type:** feature
- **Scope:** `web`, `skills`
- **PR:** [#129](https://github.com/Prism-Shadow/penguin-harness/pull/129)

[中文版](2026-07-25-agent-tuning-pipeline.zh.md)

The Web App now includes a runnable example that coordinates Agent creation, Benchmark construction, and score-driven Agent optimization without sharing private evaluation context between phases.

## Web App

The new draft-screen example launches each phase in an independent Penguin CLI Session derived from the active Project environment. Its Benchmark uses hidden context-to-action mappings so the optimizer can demonstrate measurable improvement from score-linked feedback.

Benchmark construction now uses provisional Pilot evaluations to adjust one difficulty dimension at a time before freezing and recording the Formal Baseline.

## Skills

The Agent creation, Benchmark design, evaluation, and optimization Skills now define clearer ownership and access boundaries. Benchmark builders and optimizers delegate each Case run through an explicit Evaluator request protocol, while private Rubrics and Gold answers remain confined to the evaluation worker.

Benchmark design now separates mutable Pilot calibration from the frozen Formal Baseline and prevents Rubric-only score reductions around observed answers.
