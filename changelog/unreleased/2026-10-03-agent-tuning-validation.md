# Tightened Agent Tuning execution and reporting instructions

- **Date:** 2026-10-03
- **Type:** process
- **Scope:** `skills`, `docs`

[中文版](2026-10-03-agent-tuning-validation.zh.md)

Updated Agent Tuning instructions after running benchmark reproduction and RSI
experiments through Penguin Agents.

## Details

- Specified task access boundaries, private per-cell scratch storage, explicit
  thinking configuration, and invalid results for forbidden access or aborted runs.
- Required benchmark materials to stay frozen during evaluation, with original grading,
  exact score conversions and separate evidence for each attempt and split.
- Clarified Optimizer feedback permissions, trace reading, concurrent scoreboard
  writes, observed timestamps and cost coverage.
- Kept the AWM live workflow index in one file and recorded GDPevo import and
  per-case grading requirements in its recipe.
- Added per-role feedback visibility, evidence for learned rules and workflow
  steps, actual loading/application checks, and replacement-attempt reporting.
- Required staged snapshot validation, full-State checks, scoped trace binding,
  explicit endpoint discovery policy and resolvable control-evidence paths.
- Described a separate Supervisor that can be created by General Agent without
  occupying the top of the session tree.
