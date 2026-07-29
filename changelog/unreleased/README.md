# Unreleased

Changes since v0.1.4. The version number is assigned at release, when this folder is renamed.

- [2026-07-25] Agent tuning: the Web App gains an end-to-end example for creating, benchmarking, and optimizing an Agent through isolated CLI Sessions, while the built-in tuning Skills tighten phase ownership, private evaluation boundaries, and Evaluator dispatch contracts. ([details](2026-07-25-agent-tuning-pipeline.md))
- [2026-07-28] Web App and CLI: duration and byte abbreviations now carry into the next unit instead of printing `1m60s` or `1024KB` — both helpers rounded the value they displayed but chose the unit (or the minute/second split) from the raw input. ([details](2026-07-28-duration-and-byte-formatting.md))
- [2026-07-29] Tooling: Agent-spawned commands no longer inherit PenguinHarness-owned server variables such as `PORT` / `HOST`, while the development backend moves off the installed server's default port and the Web dev proxy follows that backend. ([details](2026-07-29-harness-env-and-dev-ports.md))
