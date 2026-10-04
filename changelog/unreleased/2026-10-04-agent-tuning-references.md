# Separated Agent Tuning contracts from reference recipes

- **Date:** 2026-10-04
- **Type:** refactor
- **Scope:** `skills`

[中文版](2026-10-04-agent-tuning-references.zh.md)

Separated general initialization and evaluation rules from Penguin defaults and
method or benchmark recipes.

## Details

- Moved Penguin configuration, hook and launch instructions into references;
  added a GDPevo evaluation reference for environment and grading requirements.
- Moved ACE and AWM baseline artifacts and fixed readers into initialization
  references, linked from their optimization recipes.
- Moved Penguin's Pilot calibration and publish policy into a benchmark-design
  reference, keeping formats and parallel evaluation dispatch in the Skill.
- Specified that applicable references override general Skill instructions,
  with specialized recipes taking precedence over Penguin defaults in their scope.
