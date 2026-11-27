# Harbor evaluations share one adapter checkout

- **Date:** 2026-11-27
- **Type:** fix
- **Scope:** `skills`
- **PR:** [#1925](https://github.com/Prism-Shadow/penguin-harness/pull/1925)

[中文版](2026-11-27-harbor-adapter-main.zh.md)

Agent Evaluation learned to resolve the shared Harbor adapter's `main` branch at the start of an experiment and use the same commit for every trial. Benchmark Design updated its Case instructions to link to the shared run guide and adapter on `main` while pinning task data to a full commit.
