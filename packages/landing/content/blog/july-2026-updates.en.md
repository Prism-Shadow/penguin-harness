---
title: "July 2026 updates: scheduled tasks, Agent snapshots and a stronger evaluation center"
date: 2026-07-17
category: changelog
excerpt: Scheduled tasks, Agent State snapshots with export/import, benchmark scoreboards, the model identity principle and one-line install have all landed on main.
---

This month a batch of updates directly serving "stable evolution" landed on main. Highlights below.

## Scheduled tasks & Agent State snapshots

- **Scheduled tasks**: one TOML file per task under `agent_state/schedule/` — cron-style scheduling keeps Agents working autonomously around the clock.
- **Agent State snapshots with export/import**: `system_config.yaml` carries a `version`; risky changes (optimization passes, import overwrite) snapshot to `snapshots/v<version>.tar.gz` first, restore any time, with the live vault preserved.

## Evaluation center

- **Benchmark scoreboards**: bundled suites, per-case scoring and trend curves; evaluations are charted per model, and each run deep-links to its Session's trace view.
- **Evaluations carry the model**: the model reference moved from benchmark_config onto each evaluation (`provider` / `model_id` as a pair), making cross-model comparison direct.

## Model system

- **Model identity principle**: a model is uniquely identified by the `(provider, model_id)` pair; connection details live inline on the Project config entry, with client-resolved environment-variable fallback when the credential is left empty.
- **Custom provider groups**: beyond built-in vendors and custom, users can create their own groups (OpenAI protocol by default, base URL required).
- **Runtime baseline raised to Node ≥ 24**: bundled runtime, CI and the release pipeline all migrated.

## Install & experience

- **One-line install**: a repo-root `install.sh` — `curl | sh` detects Linux / macOS and x64 / arm64; artifacts bundle the Node runtime, unpack and run.
- **Skill library revamp**: Skills now use files as the runtime source of truth, with redesigned cards and quick invocation; built-in Agents converge to a single default_agent, with agent creation/optimization fully carried by the Skill library.
- **Stability fixes**: Gemini tool_call_id collisions on consecutive same-name calls, stream-view scroll jitter on short containers, and WorkGroup parallel tool timing are all fixed.
