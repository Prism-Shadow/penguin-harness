# InfraRSI RSI toolkit

- **Date:** 2026-11-13
- **Type:** feature
- **Scope:** `skills`, `docs`

[中文版](2026-11-13-infrarsi-rsi-toolkit.zh.md)

Added `infrarsi-rsi-toolkit`, which speeds up an existing training job with [InfraRSI](https://arxiv.org/abs/2611.11558). Contributor: [Nhckdvrl](https://github.com/Nhckdvrl).

## How it runs

- The Skill fetches the upstream engine and its `infrarsi-optimize` Skill at a pinned commit and builds them outside the project. Upstream has no license file, so the plugin carries neither their code nor their text.
- The Agent follows the upstream Skill unchanged: it drafts the task contract with the user, starts the engine and keeps it going. The engine measures the reference run and its noise, searches launch settings and code patches, re-runs the winner back to back with the original, and writes the report.
- Every engine request goes to a fresh `run_subagent` session on the Session's own model, which reads only the request directory.
- `infrarsi agent next` waits within the command tool's two-minute limit. Nothing is written to the user's code until they agree.

## Packaging

The plugin declares its card and Skill in `src/index.ts`, and is registered for server, CLI, desktop and landing packaging, the bilingual plugin catalogs, the Skills docs and the landing algorithm list. It carries the SKILL.md parse check the library's other skill plugins run.
