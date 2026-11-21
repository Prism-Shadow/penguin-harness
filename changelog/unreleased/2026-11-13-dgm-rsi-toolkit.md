# The DGM toolkit evolves a coding agent from an archive of its own variants

- **Date:** 2026-11-13
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **Issue:** [penguin-harness-community #72](https://github.com/Prism-Shadow/penguin-harness-community/issues/72)

[中文版](2026-11-13-dgm-rsi-toolkit.zh.md)

Added `dgm-rsi-toolkit`, which improves a Target Agent the way the [Darwin Gödel Machine](https://arxiv.org/abs/2505.22954) does (Sakana AI, 2025): it keeps an archive of coding-agent variants and lets fresh subagent sessions modify the Target's Skill files. Contributor: [leslie520-bye](https://github.com/leslie520-bye).

## How it runs

- The Skill creates the Target Agent's learning slot and seeds the archive with the freshly initialized Target, so the baseline agent is always archived before the first modification.
- Each round selects parents from the archive by score and diversity, then one fresh `run_subagent` session per child rewrites the parent's Skill files. Every candidate is measured on the frozen Benchmark; the archive grows by measured children only.
- Two rounds with one child per round are enough to see the loop end to end: the report gives the baseline score, the best score and the archive tree, so every claim traces back to a Benchmark run.
- The archive, not the working copy, is the source of truth: nothing reaches the Target's Skill files outside a measured child.

## Packaging

The plugin declares its card and Skill in `src/index.ts`, with `preinstall: false`, and is registered for server, CLI, desktop and landing packaging, the bilingual plugin catalogs, the Skills docs and the landing algorithm list. It carries the SKILL.md parse check the library's other skill plugins run.
