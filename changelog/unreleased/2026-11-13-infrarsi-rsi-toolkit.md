# The InfraRSI toolkit speeds up a training job with the upstream engine

- **Date:** 2026-11-13
- **Type:** feature
- **Scope:** `plugins`, `skills`, `docs`, `landing`
- **Issue:** [penguin-harness-community #71](https://github.com/Prism-Shadow/penguin-harness-community/issues/71)

[中文版](2026-11-13-infrarsi-rsi-toolkit.zh.md)

Added `infrarsi-rsi-toolkit`, which speeds up an existing training job with [InfraRSI](https://arxiv.org/abs/2611.11558). Contributor: [Nhckdvrl](https://github.com/Nhckdvrl).

## How it runs

- The Skill fetches the upstream engine and its `infrarsi-optimize` Skill at a pinned commit and builds them outside the project. Upstream has no license file, so the plugin carries neither their code nor their text.
- The Agent follows the upstream Skill unchanged: it drafts the task contract with the user, starts the engine and keeps it going. The engine measures the reference run and its noise, searches launch settings and code patches, re-runs the winner back to back with the original, and writes the report.
- Every engine request goes to a fresh `run_subagent` session of an `infrarsi_answerer` Agent, on the Session's own model. That Agent has only `read_file`, `write_file` and `exec_command`, and its rules allow the shell only for printing the request's files, because `read_file` cuts lines past 2000 characters and the engine writes each prompt as one line.
- `infrarsi agent next` waits within the command tool's two-minute limit. Nothing is written to the user's code until they agree.

## Packaging

The plugin declares its card and Skill in `src/index.ts`, with `preinstall: false`, and is registered for server, CLI, desktop and landing packaging, the bilingual plugin catalogs, the Skills docs and the landing algorithm list. It carries the SKILL.md parse check the library's other skill plugins run.
