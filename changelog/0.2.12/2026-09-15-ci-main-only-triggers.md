# CI and the pages build run only for main

- **Date:** 2026-09-15
- **Type:** process
- **Scope:** `ci`
- **PR:** [#731](https://github.com/Prism-Shadow/penguin-harness/pull/731)

[中文版](2026-09-15-ci-main-only-triggers.zh.md)

## What changed

- The CI workflow runs on a push to `main` and on a pull request whose base is `main`, and on nothing else: the `dev` push trigger is gone, and a pull request against any other branch — a stacked PR, an integration branch — no longer starts a run until it is retargeted at `main` (a manual dispatch still works). One run is 21 jobs on a shared runner pool, and that is where the queue was going.
- The pages and Docker workflows' pull-request triggers take the same base filter, on top of their existing path filters; their push triggers were already `main` only.
