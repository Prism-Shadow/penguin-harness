---
name: skilladam-rsi-toolkit
description: "Run a SkillAdam experiment on the Project's selected Benchmarks: train once in a continuing Agent Session, freeze the learned Skill, then evaluate it repeatedly on held-out tasks."
version: 2026.10.29.2
---

# SkillAdam

You are the experiment's main Penguin. Read the selected Benchmarks, prepare the runtime, arrange training and testing, and collect the results. Continue until the requested experiment is complete.

The **Target Agent** is the Penguin that learns or solves tasks inside the benchmark environment. For each selected benchmark or independent training unit, train once in one continuing Session and one container. The learner controls its task attempts and Skill updates there. Repeated tests use the same frozen Agent State, with fresh environments and conversations for every task attempt.

## The method

[SkillAdam: Stable and Efficient Skill Evolution for Agents](https://arxiv.org/abs/2609.08944v1), §4 and Algorithm 1, optimizes a Markdown Skill while keeping the model and tools fixed. The [author implementation](https://github.com/ruc-datalab/SkillAdam/tree/b6c9640f7a9e0d5e3a500c25bc4e6369eeca78f1) is the implementation reference.

First, the learner attempts training tasks without a learned Skill. It uses those trajectories and evaluator feedback to write an initial Skill. Each subsequent iteration runs the current Skill, proposes an edit, and evaluates the candidate on the same training cases. The benchmark's acceptance rule decides whether to retain the edit.

Two persistent states distinguish SkillAdam:

- **Evolving Issue Tracker (EIT): what to change.** Record recurring problems and the outcomes of attempted fixes. Later proposals use this history together with the latest trajectories and feedback.
- **Adaptive edit budget: how much to change.** Track an exponential moving average of the variance of per-case score changes. Inconsistent effects shrink the next edit budget; consistent effects allow it to recover.

Both states are updated after evaluating a candidate, including rejected candidates. The output is the last accepted Skill. Held-out test feedback never updates it. [The learning instructions](references/training.md) give the equations and iteration order; install them for the training Target.

## Before you start

Find the selected Benchmarks in the current Project, using the Environment's App Data Dir. Read their manifests and Case statements, then follow the linked runtime instructions. Built-in packages contain descriptions and run instructions; fetch task sources and environments when those instructions require them. A request naming the installed Benchmarks is sufficient: the user need not supply a repository link.

Match each selected benchmark's Train and Test packages from their documentation. Package Cases may represent either a single question or an entire continuous training task. Use the documented native paths rather than deriving paths from package names or old task-group numbers. For repository-backed tasks, use the full 40-character lowercase commit declared by the Case and package, and keep that checkout throughout the experiment. [Benchmark setup](references/benchmark.md) covers this handoff.

Resolve the remaining settings from the request and benchmark instructions:

- Model, thinking level, tools and base Agent State.
- Training units, initialization cases, batch size, training sampling seed, proposal iterations and test repetitions (default: three).
- Acceptance metrics, optimizer parameters, comparison versions, time limits and Docker capacity.

Fix an experiment/report version before launching. Prefer the user's specified versions; otherwise select and record the resolved versions of the runtime, benchmark, model and toolkit. Keep that configuration fixed through training and testing, and identify each measured Skill and Agent State by its frozen version.

Use all Train and Test questions unless the request selects a subset. Each independent benchmark or training unit learns its own Skill once from the common base State. Freeze that result and reuse it for all test repetitions. Keep the runtime fixed across comparisons and each benchmark's learned state separate.

The numerical helper defaults are `beta2=0.9`, `base_budget=4`, `min_budget=1`, `variance_cap=0.1`; the budget counts unified-diff hunks. Its default gate is strict improvement of mean normalized reward, without a per-case regression threshold. Use that gate when it matches the benchmark's declared rule; otherwise apply that rule and use the helper only for volatility and budget calculations. The dataset, test repetition count and proposal iteration count are experiment settings, not properties of SkillAdam.

## Run the experiment

1. **Prepare.** Follow [initialization](references/initialization.md): record the resolved plan, make a common base State, and prepare one training State per benchmark or independent training unit. Reuse the selected runtime; [source builds](references/source-bundle.md) are only needed when the experiment requires one.
2. **Train once.** Launch the benchmark's continuous training entry point. Give its Target the learner instructions, helper and training brief through the supported State handoff. Complete all requested proposal iterations inside that Session and container; a candidate update does not create another Harbor trial.
3. **Collect and freeze.** Collect the last accepted Skill, answers, measured scores, decisions and optimizer history. Freeze the complete Skill folder, including supporting files. If no candidate was accepted, the initial Skill is the final result.
4. **Test repeatedly.** Evaluate the pre-training base State and the final learned State on the complete held-out set three times each by default. The base has no learned Skill unless the user supplied one. Build the final test State from the same base, adding only the frozen Skill and its reader instruction. Every case and repetition starts from the corresponding State in a fresh environment and conversation, with the same model, thinking level, tools and scoring conditions. Reuse the frozen archives; do not retrain or carry answers, memory or conversation history between test attempts.
5. **Report.** Follow [evaluation and reporting](references/evaluation.md). Collect native results, versions, the training curve, costs, elapsed time and token usage; publish to the Project's Evaluation Center when applicable.

You own scheduling. When `run_subagent` is available, workers can launch and collect trials: one training worker owns a whole learning run, and a test worker owns one held-out case in one test repetition. Give each trial a separate working directory and output path. A worker does not start another experiment controller. Use the supported background mechanism, retain job identifiers, collect completions and fill available capacity until the requested work is done.

Count every container started for this experiment, including network sidecars, toward the user's Docker limit, and respect the benchmark's per-host limit. Leave unrelated workloads unchanged. Keep a short index of completed, active and pending work with artifact paths. A process launch is not a completed measurement; inspect the runner's final result before recording a score.

## Report the result

Use the [common report fields](references/evaluation.md#common-report-fields): `baseline` and `final` for the two frozen States, `run` for test repetitions, and `mean`, `std` and `final_minus_baseline` for the comparison. Keep training stages separate from test repetitions.

Report Train and Test separately for each benchmark, with these records:

| Record | Required detail |
| --- | --- |
| Scores | Test `mean` and `std`, calculated across repetitions as below, with the underlying per-case scores. Report single-run training scores without an across-run standard deviation. |
| Versions | The fixed experiment/report version, resolved runtime, benchmark, model and toolkit versions, and each frozen Skill/Agent State version. Prefer user-specified versions. |
| Cost | Training cost for producing each learned Skill; test cost for every case, repetition and measured State; separate Train/Test totals. |
| Time | Start, end and elapsed time at the same granularity as cost, with separate Train/Test totals and actual experiment wall-clock time. |
| Tokens | Cached input, uncached input, output, total input and total tokens at the same granularity as cost and time, with separate Train/Test totals. |
| Test comparison | Test scores for the pre-training base State and final learned State. |
| Training curve | Actual measured training scores across SkillAdam's optimization iterations, with candidate scores and acceptance decisions. Methods without iterative training scores need no curve. |

Keep candidate scores and the final training verifier grade as separate records. A curve uses the actual measurement for that iteration, not a cumulative maximum. One training run has no across-run sample standard deviation.

For each frozen State, each test repetition covers the complete selected test set. Apply the benchmark's aggregation rule within each repetition; for a mean-score benchmark, average all its test-case scores. Three repetitions give three benchmark scores. Report the mean and **sample standard deviation of those three scores**, measuring variation between test repetitions of the same frozen State.

For an overall score on a common scale, first average the selected benchmarks' scores within repetition 1, and likewise for repetitions 2 and 3. Calculate the mean and sample standard deviation of those three overall scores. Do not average per-case or per-benchmark standard deviations. Use the requested repetition count if it differs from three; one repetition has no sample standard deviation. Average all repetitions rather than selecting the best, and do not label this score pass@k.

Include incomplete runs, method deviations and paths to the frozen Skills and results. Mark unavailable cost, time or token values as unknown.
