# TRACE skill-bank evolution toolkit

- **Date:** 2026-10-13
- **Type:** feature
- **Scope:** `skills`, `docs`
- **PR:** [Saigyouji-Yuyuko1000/penguin-harness#5](https://github.com/Saigyouji-Yuyuko1000/penguin-harness/pull/5)

[中文版](2026-10-13-trace-rsi-toolkit.zh.md)

Added `trace-rsi-toolkit` to the Agent Self-Evolution plugins and algorithm catalogue.

## Training and measurement

Reports use shared `baseline`/`final`, repetition, version, score and resource field names. Keep method-specific learning records separate from repeated Test statistics.

Training progress uses numbered `step` labels and retains native stage names for traceability.

The host entry Skill organizes published continuous-training Benchmarks; a separate training reference becomes the in-container Curator Skill. Fresh Actors solve each task twice per batch by default. The Curator bootstraps B0 and evolves two rounds, selecting best_train only after all batches finish. The selected bank and a no-Skill baseline each receive three complete test repetitions. Reports include mean and sample SD across repetition means, stage scores, selection evidence and resource costs. Benchmark paths and runtime contracts come from the current published packages.

## Deployment adaptation

The Target received a fixed bank reader and a selection log in its Session scratchpad. Skill selection followed instructions; previously read bodies remained in conversation history. The toolkit documented this difference from the paper's per-turn context replacement, distinguished missing selection evidence from explicit empty selections, and kept private scoring material out of Curator inputs.
