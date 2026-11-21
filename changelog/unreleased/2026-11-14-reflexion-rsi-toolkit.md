# The Reflexion toolkit turns score matrices into written reflections

- **Date:** 2026-11-14
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **Issue:** [penguin-harness-community #73](https://github.com/Prism-Shadow/penguin-harness-community/issues/73)

[中文版](2026-11-14-reflexion-rsi-toolkit.zh.md)

Added `reflexion-rsi-toolkit`, which reproduces [Reflexion](https://arxiv.org/abs/2303.11366) as an Agent's trial loop. Contributor: [leslie520-bye](https://github.com/leslie520-bye).

## How it runs

- The Skill initializes a reflection slot in the Target's Agent State: `skills/reflexion-memory/` holds the episodic buffer `reflections.md`, and one fixed reader line in `AGENTS.md` makes the Target read it before every task.
- Trial 1 measures the base State. After every later trial, a Reflector — a fresh `run_subagent` session on the Session's own model — turns the score matrix and the failed cases' public statements into one short written reflection, appended to the buffer; the oldest entries beyond the buffer size leave it.
- Trials run on the frozen Benchmark through the family's shared evaluation reference (byte-identical to the one opro, ape, ace and awm ship), and the best-scoring trial's snapshot is the experiment's deliverable.
- The Reflector never sees a Rubric, a Trace or any case's answer: the paper's metric-feedback mode, declared as an adaptation, with the family's objective-hacking guards.

## Packaging

The plugin declares its card and Skill in `src/index.ts`, with `preinstall: false`, and is registered for server, CLI, desktop and landing packaging, the bilingual plugin catalogs, the Skills docs and the landing algorithm list. It carries the SKILL.md parse check the library's other skill plugins run.
