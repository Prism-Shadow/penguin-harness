# The landing lists Benchmarks with no upstream

- **Date:** 2026-11-04
- **Type:** fix
- **Scope:** `landing`, `agents`
- **PR:** [#1458](https://github.com/Prism-Shadow/penguin-harness/pull/1458)
- **Issue:** [#1452](https://github.com/Prism-Shadow/penguin-harness/issues/1452)

[中文版](2026-11-04-landing-original-benchmarks.zh.md)

The hero's Benchmarks row gains Biomedicine, the built-in Benchmark written for the Benchmark repository itself. A Benchmark with no upstream links to its own package in [penguin-harness-benchmark](https://github.com/Prism-Shadow/penguin-harness-benchmark).

## Details

- Each Benchmark entry names its kind by key. The zh and en dictionaries map the key to the label, so the compiler checks that every entry has one in both languages.
- `packages/landing/test/rsi-stats.test.ts` is removed. It pinned the hero's hand-kept lists to the plugins folder and to the Benchmark catalogue cloned from the other repository's `main`, so a merge there failed CI for every open pull request.
- The dev skill's testing rules name two more kinds of test that never earn a place: sync checks between a hand-kept list and its source, and tests that read what this repository does not pin (another repository's live branch, the real network, today's date).
