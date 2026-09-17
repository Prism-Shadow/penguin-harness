---
title: "July 2026 updates: scheduled tasks, Agent State snapshots and Benchmark scoreboards"
date: 2026-07-17
category: changelog
excerpt: Scheduled tasks, Agent State snapshots with export and import, Benchmark scoreboards, the model identity principle and a one-line install have landed on main.
---

> Written for PenguinHarness 0.0.1. Later releases may differ in some details.

This month, a batch of updates aimed at stable self-evolution landed on main. Agents can now run on a schedule, Agent State is snapshotted before risky changes, and the Evaluation Center charts Benchmark results per model. The highlights are below.

## Scheduled tasks and Agent State snapshots

- **Scheduled tasks.** Each task is one TOML file under `agent_state/schedule/`. Cron-style schedules keep agents working on their own around the clock.
- **Agent State snapshots, with export and import.** `system_config.yaml` records a `version`. Before a risky change, such as an optimization pass or an import that overwrites the current state, the Agent State is saved to `snapshots/v<version>.tar.gz`. You can restore a snapshot at any time, and restoring one keeps the live Vault.

## Evaluation Center

- **Benchmark scoreboards.** The Evaluation Center gains bundled suites, per-case scores and trend curves. Evaluations are charted per model, and each run links straight to its Session's Trace.
- **Evaluations record the model.** The model reference moved from `benchmark_config` onto each evaluation, stored as a `provider` / `model_id` pair, so comparing models is direct.

## Model system

- **Model identity principle.** A model is uniquely identified by its `(provider, model_id)` pair. Connection details are stored inline on the model's entry in the Project config. When the credential is left empty, the client falls back to environment variables.
- **Custom provider groups.** Besides the built-in vendor groups and the Custom group, you can create your own groups. They use the OpenAI protocol by default and require a base URL.
- **Node 24 or later.** The runtime baseline is now Node ≥ 24. The bundled runtime, CI and the release pipeline have all moved to it.

## Install and experience

- **One-line install.** A new `install.sh` at the repository root runs as `curl | sh` and detects Linux / macOS and x64 / arm64. The release artifacts bundle the Node runtime, so you unpack them and run.
- **Skill library redesign.** Skills now use their files as the runtime source of truth, the Skill cards are redesigned, and Skills can be invoked quickly. The built-in agents are merged into a single `default_agent`, and building and optimizing agents is handled entirely by the Skill library.
- **Stability fixes.** Fixed colliding `tool_call_id` values when Gemini calls the same tool several times in a row, jitter when scrolling up through streaming output in a short scroll area, and the elapsed time shown for parallel tool calls in a WorkGroup.
