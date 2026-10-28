# RSI experiment toolkits

- **Date:** 2026-10-28
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [#1374](https://github.com/Prism-Shadow/penguin-harness/pull/1374)

[中文版](2026-10-28-rsi-toolkits.zh.md)

Added four RSI toolkits. A controller Penguin reads the selected Project Benchmarks, organizes learning and compares frozen baseline and final States.

## Methods and contributors

| Method | Contributor | Learning process |
| --- | --- | --- |
| SkillAdam | [Saigyouji-Yuyuko1000](https://github.com/Saigyouji-Yuyuko1000) | Evolving issue tracker, adaptive edit budgets and paired candidate evaluations. |
| Evo-Harness | [lzh368](https://github.com/lzh368) | One Solver pass, reflection in the original Session and one batch Skill compilation. |
| OpenSkill | [ArisaZz](https://github.com/ArisaZz) | External research and independent virtual verification; freeze the last revision before target scoring. |
| TRACE | [rank-Yu](https://github.com/rank-Yu) | Curator/Actor learning from trajectories, with checkpoint selection from complete training measurements. |

Shared reporting and plugin integration: [Saigyouji-Yuyuko1000](https://github.com/Saigyouji-Yuyuko1000).

## Shared experiment records

- Train once per independent unit, then test each frozen baseline/final State three complete times by default. Each test task uses a fresh environment and conversation.
- Report mean and sample standard deviation across complete test repetitions. Aggregate questions within each repetition first; for overall results, also average Benchmarks within each repetition first. Keep Train and Test separate.
- Record experiment, component and State versions, preferring user-specified versions. Record cost, time and cached-input, uncached-input and output tokens per training unit and test-case repetition.
- Use `baseline`/`final` for comparisons and numbered `step` labels for training progress, retaining original stage names for traceability. SkillAdam and TRACE record Train-score curves; OpenSkill records virtual validation; Evo-Harness does not require an iterative curve.

## Packaging

Registered all four plugins for core, CLI and desktop packaging, the bilingual plugin catalogs and the website algorithm list. Shipped plugins omit development tests; OpenSkill has no development acceptance or replay prerequisite.

Repositories without GDPevo manifests no longer load PyYAML during Evo resource preparation. GDPevo retains its declared PyYAML dependency.
