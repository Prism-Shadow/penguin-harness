# GDPevo Train and GDPevo Test join the built-in Benchmarks

- **Date:** 2026-10-12
- **Type:** feature
- **Scope:** `core`, `landing`, `docs`, `skills`
- **PR:** [#1064](https://github.com/Prism-Shadow/penguin-harness/pull/1064)

[中文版](2026-10-12-builtin-gdpevo.zh.md)

A new Project started with two more built-in Benchmarks after Sec A to Sec E:
**PenguinHarness Benchmark GDPevo Train** (`penguinharness-benchmark-gdpevo-train`) and
**PenguinHarness Benchmark GDPevo Test** (`penguinharness-benchmark-gdpevo-test`). They were the two
halves of the GDPevo subset in Prism-Shadow/penguin-harness-benchmark: real-job business tasks in
six company environments, the train tasks to optimize an agent on and the held-out test tasks of
the same environments to evaluate it on. Like the other built-ins, the product carried only their
text; the task folders, the business environments and every large file stayed in that repository.

## Details

- **What a Project gets.** Each was written with `runs = 1`, `status = "published"`, no
  evaluations and 30 cases, `CASE-NNN-tg<group>-<split>-<n>`. The files were the ones the benchmark
  repository publishes under `packages/` at version `2026.10.12.1`, byte for byte, so a built-in
  copy and an imported one matched; `scripts/benchmark-packages.mjs` wrote these two packages
  too.
- **Statements.** Every statement linked its task folder, the repository's run rules and the
  checkout at commit `3389565`, the commit the packages were written at. The launch allowed only
  the model provider's API host, because GDPevo's answers are public; the score was the upstream
  grader's score as a fraction of 1, × 100, so a partly correct answer earned part of the points,
  and the rubric named the grader.
- **Core data.** A built-in Benchmark carried its own pinned commit, and optionally a measured
  results page, a task's place upstream and a grader's scale; Sec A to Sec E kept theirs, and their
  files did not change.
- **Landing page.** The hero's Benchmarks row listed GDPevo once, as "Agent self-evolution"
  (「Agent 自进化」), linking the GDPevo repository.
- **Docs and Skill.** The Evaluation Center page listed the two with their pairing, the partial
  scores and the GDPevo calibration results, and told how to import a built-in an existing Project
  lacks; the Self-Improvement page and the `benchmark-design` Skill's package reference
  (`2026.10.12.1`) stopped counting the built-ins.

## Existing Projects

A Project created by an earlier release was not given the two GDPevo Benchmarks. Importing a
package folder from the benchmark repository added one, as before.
