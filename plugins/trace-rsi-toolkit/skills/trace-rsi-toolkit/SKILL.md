---
name: trace-rsi-toolkit
description: Organize TRACE experiments on published Benchmarks, train a modular skill bank from Actor trajectories, select a checkpoint by training scores, and compare it with a no-Skill baseline on independent tests.
version: 2026.10.28.3
---

# TRACE

[TRACE v2, §2 and Algorithms 1–2](https://arxiv.org/abs/2608.22793v2) and the [upstream implementation at 309714a](https://github.com/Darwin-Agent/Car-bench-TRACE/tree/309714aa7dcc4c54ae1f7d2bff0fbc4908593285): Actors select operation skills while solving tasks; a Curator distills and revises those skills from successful and failed trajectories. Model weights and tools stay fixed.

This is the outside experiment Organizer's entry point. The Organizer prepares and launches runs, collects artifacts and reports results. Inside each training environment, a continuing main Agent is the Curator and delegates each task attempt to a fresh Actor session. Install [training.md](references/training.md) there as `trace-training`; Actors and test solvers receive only solving instructions and their frozen bank.

## Before you start

Read [benchmark.md](references/benchmark.md) to discover the selected Project's published Train/Test packages and their run contracts. Use the user's benchmark, source version, runtime, output location and budgets when supplied; otherwise resolve them from the current Environment and package instructions. Ask only for essentials that cannot be resolved.

| Setting | Default |
| --- | --- |
| Independent training runs per benchmark/training unit | 1 |
| Actor attempts per task per batch, A | 2 |
| Evolution rounds, R | 2; R=0 means bootstrap only |
| Checkpoint selection | `best_train` over validated B0…BR, using complete training measurements |
| Test conditions | No-Skill base and the selected bank |
| Complete test repetitions per condition | 3 |
| Harbor trial concurrency | 4, shared across owned training and testing jobs |
| Monitoring interval | 10 minutes; handle completion notifications promptly |

These are toolkit choices, not paper constants. Fix the configuration before learning. Use sorted public task ids with each task's attempts in order unless another order is supplied. Each batch covers every task × A attempts. H1 is the empty-bank batch, B0 is bootstrap, and B1…BR are evolution batches. Five tasks, A=2 and R=2 mean 40 fresh Actor sessions in one training run; five held-out tasks and three repetitions mean 15 test trials per condition, 30 including the baseline.

Resolve provider, model and thinking level for Organizer, Curator, Actor and test solver. Pass the solving runtime explicitly; Actor and test solver settings must match. Honor requests for the same model in all roles, including the Organizer; disclose an actual runtime mismatch before model work.

## Prepare and run

1. **Prepare.** Follow [initialization.md](references/initialization.md) for the common base, Actor and Curator States, training request, public benchmark brief and exports. Record versions, task order, roles, budgets, resource limits and selection rule in `experiment.yaml`. For repository-backed experiments, keep organizer-authored records under `<benchmark-repository>/jobs/<experiment-id>/` unless the user specifies another location. Use the runner's native directories for raw trials.
2. **Launch training.** Use the published adapter and CLI, with the Curator State archive, explicit identity/runtime and benchmark limits. Launch one continuous training trial per independent unit; A and R run inside it, not as Harbor repetitions. Separate units use separate business environments. Only a requested source-built runtime needs [source-bundle.md](references/source-bundle.md).
3. **Monitor.** Save each launch configuration, State digest, job/trial path and process handle in `state.yaml`. Use the runtime's supported background mechanism with completion notifications, keep this organizing task active and inspect owned jobs at the configured interval. Wait in chunks the available tools support. A state file enables recovery; it does not wake an ended Agent. On resume, reconcile live processes and native results before launching missing work.
4. **Collect and select.** Follow [evaluation.md](references/evaluation.md). Collect every prescribed batch, snapshot and publication record. Independently recompute `best_train` from complete training measurements and verify the exported bank digest. The final training verifier's exported-answer score is a separate measurement. Incomplete evidence does not justify selecting from a convenient subset.
5. **Test.** Freeze the selected bank before any test starts. Construct the no-Skill and selected-bank States from the same base, then schedule a complete case × repetition matrix for each. Each cell uses a fresh environment and conversation. Testing and other units' training may overlap within the shared resource limits. Test feedback never changes the bank or checkpoint selection. Evaluate intermediate banks only when requested before testing.
6. **Report.** Publish complete matrices to the native scoreboard. Use the [common report fields](references/evaluation.md#common-report-fields): `baseline` and `final` for the two frozen States, `run` for test repetitions, and `mean`, `std` and `final_minus_baseline` for the comparison. Retain actual training stages and the selected checkpoint, costs, token categories, elapsed time and failures. Keep progress and final reports tied to the same experiment version.

Follow the benchmark's retry policy, preserving failed attempts and distinguishing infrastructure failures from scored outcomes. Default to at most one automatic retry when that policy permits it; never retry a completed answer because its score is low. Report unresolved blockers while allowing unrelated owned jobs to proceed.

## Method and experiment adaptations

Training-score checkpoint selection is this experiment's adaptation. Keep evolution from the current bank even after a score drop; choose only after completing the budget. The main Curator performs all analysis itself. Fresh Actors share the unit's business environment, so record state carryover where applicable.

Instruction-based skill selection and retained skill text within an Actor session differ from upstream per-turn context replacement. Report these differences, runtime replacements, chosen budgets and feedback limitations; do not claim an exact reproduction of CAR-bench results.
