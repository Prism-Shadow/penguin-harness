---
name: trace-rsi-toolkit
description: "Evolve a modular skill bank with TRACE from Actor trajectories and Curator distillation, and select a checkpoint by training scores."
version: 2026.11.17.1
---

# TRACE

[TRACE v2, §2 and Algorithms 1–2](https://arxiv.org/abs/2608.22793v2) and the [upstream implementation at 309714a](https://github.com/Darwin-Agent/Car-bench-TRACE/tree/309714aa7dcc4c54ae1f7d2bff0fbc4908593285): Actors select operation skills while solving tasks; a Curator distills and revises those skills from successful and failed trajectories. Model weights and tools stay fixed.

This is the outside entry point for running TRACE. Follow the experimental setup specified by the user's request and the selected Benchmark's instructions. Inside a training environment, a continuing main Agent is the Curator and delegates each task attempt to a fresh Actor session. Install [training.md](references/training.md) there as `trace-training`; Actors and test solvers receive only solving instructions and their frozen bank.

## Before you start

Read [benchmark.md](references/benchmark.md) to discover the selected Project's published Train/Test packages and their run contracts. Use the user's benchmark, source version, runtime, output location and budgets when supplied; otherwise resolve them from the current Environment and package instructions. Ask only for essentials that cannot be resolved.

| Setting | Default |
| --- | --- |
| Actor attempts per task per batch, A | 2 |
| Evolution rounds, R | 2; R=0 means bootstrap only |
| Checkpoint selection | `best_train` over validated B0…BR, using complete training measurements |

Fix the configuration before learning. Use sorted public task ids with each task's attempts in order unless another order is supplied. Each batch covers every training task × A attempts: H1 is the empty-bank batch, B0 is bootstrap, and B1…BR are evolution batches (for N training tasks, one training run executes `(R + 2) × N × A` fresh Actor sessions). How benchmarks are organized (for example, running a single benchmark or running multiple benchmarks independently), which States are compared, how many evaluation repetitions are executed, and concurrency limits follow the user's prompt and the Benchmark's documentation rather than being prescribed by this Skill.

Resolve provider, model and thinking level for Organizer, Curator, Actor and test solver. Pass the solving runtime explicitly; Actor and test solver settings must match. Honor requests for the same model in all roles, including the Organizer; disclose an actual runtime mismatch before model work.

## Prepare and run

1. **Prepare.** Follow [initialization.md](references/initialization.md) for the common base, Actor and Curator States, training request, public benchmark brief and exports. Record versions, task order, roles, budgets, resource limits and selection rule in `experiment.yaml`. Use the requested output directory, otherwise this Session's workspace or scratchpad. Use the runner's native directories for raw trials.
2. **Launch training.** Use the published adapter and CLI, with the Curator State archive, explicit identity/runtime and benchmark limits, according to the user's requested experimental design and the Benchmark's runtime contract. A and R run as batches inside the training session, not as separate outer evaluation repetitions. Reuse the Benchmark runtime or the source-built bundle requested for this experiment.
3. **Monitor.** Save each launch configuration, State digest, job/trial path and process handle in `state.yaml`. Use the runtime's supported background mechanism with completion notifications, collect completions and keep the launch index current. On resume, reconcile live processes and native results before launching missing work.
4. **Collect and select.** Follow [evaluation.md](references/evaluation.md). Collect every prescribed batch, snapshot and publication record. Independently recompute `best_train` from complete training measurements and verify the exported bank digest. The final training verifier's exported-answer score is a separate measurement. Incomplete evidence does not justify selecting from a convenient subset.
5. **Evaluate.** Freeze the selected bank before any held-out evaluation starts. Follow the evaluation schedule specified by the user's request (such as comparing the no-Skill baseline and selected-bank States across the requested evaluation repetitions), with a fresh environment and conversation for each cell. Test feedback never changes the bank or checkpoint selection. Evaluate intermediate banks only when requested before testing.
6. **Report.** Publish complete matrices to the native scoreboard. Use the [common report fields](references/evaluation.md#common-report-fields): `baseline` and `final` for the two frozen States, `run` for test repetitions, and `mean`, `std` and `final_minus_baseline` for the comparison. Retain actual training stages and the selected checkpoint, costs, token categories, elapsed time and failures. Keep progress and final reports tied to the same experiment version.

Follow the benchmark's retry policy, preserving failed attempts and distinguishing infrastructure failures from scored outcomes. Do not retry a completed answer because its score is low. Report unresolved blockers while allowing unrelated owned jobs to proceed.

Record the actual H1 and B0…BR measurements with `curve_kind: benchmark_score`, retaining the selected checkpoint separately from the last stage.

## Method and experiment adaptations

Training-score checkpoint selection is this experiment's adaptation. Keep evolution from the current bank even after a score drop; choose only after completing the budget. The main Curator performs all analysis itself. Fresh Actors share the unit's business environment, so record state carryover where applicable.

Instruction-based skill selection and retained skill text within an Actor session differ from upstream per-turn context replacement. Report these differences, runtime replacements, chosen budgets and feedback limitations; do not claim an exact reproduction of CAR-bench results.
