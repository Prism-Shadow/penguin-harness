---
name: skilladam-rsi-toolkit
description: "Evolve a reusable Markdown Skill with SkillAdam from execution trajectories and feedback using an Evolving Issue Tracker (EIT) and a variance-adaptive edit budget."
version: 2026.11.17.1
---

# SkillAdam

You are the main Penguin running SkillAdam. Follow the experimental setup specified by the user's request and the selected Benchmark's instructions.

The **Target Agent** is the Penguin that solves tasks and refines its Skill inside the task environment. How benchmarks are organized (for example, running a single benchmark or running multiple benchmarks independently), how many training iterations to perform, and how many evaluation passes to run are defined by the user's prompt and the Benchmark's documentation rather than prescribed by this Skill.

## The method

[SkillAdam: Stable and Efficient Skill Evolution for Agents](https://arxiv.org/abs/2609.08944v1), §4 and Algorithm 1, optimizes a Markdown Skill while keeping the model and tools fixed. The [author implementation](https://github.com/ruc-datalab/SkillAdam/tree/b6c9640f7a9e0d5e3a500c25bc4e6369eeca78f1) is the implementation reference.

First, the learner attempts training tasks without a learned Skill. It uses those trajectories and evaluator feedback to write an initial Skill. Each subsequent iteration runs the current Skill, proposes an edit, and evaluates the candidate on the same training cases. The benchmark's acceptance rule decides whether to retain the edit.

Two persistent states distinguish SkillAdam:

- **Evolving Issue Tracker (EIT): what to change.** Record recurring problems and the outcomes of attempted fixes. Later proposals use this history together with the latest trajectories and feedback.
- **Adaptive edit budget: how much to change.** Track an exponential moving average of the variance of per-case score changes. Inconsistent effects shrink the next edit budget; consistent effects allow it to recover.

Both states are updated after evaluating a candidate, including rejected candidates. The output is the last accepted Skill. Held-out test feedback never updates it. [The learning instructions](references/training.md) give the equations and iteration order; install them for the training Target.

## Before you start

Find the selected Benchmarks in the current Project, using the Environment's App Data Dir. Read their manifests and Case statements, then follow the linked runtime instructions. Built-in packages contain descriptions and run instructions; fetch task sources and environments when those instructions require them. A request naming the installed Benchmarks is sufficient: the user need not supply a repository link.

Match each selected benchmark's Train and Test packages from their documentation. Package Cases may represent either a single question or an entire continuous training task. Use the documented native paths rather than deriving paths from package names or old task-group numbers. For repository-backed tasks, use the full 40-character lowercase commit declared by the Case statement, and keep that checkout throughout the experiment. [Benchmark setup](references/benchmark.md) covers this handoff.

Resolve the remaining settings from the request and benchmark instructions:

- Model, thinking level, tools and base Agent State.
- Selected benchmarks or tasks, initialization cases, batch size, training sampling seed, proposal iterations and evaluation runs.
- Acceptance metrics, optimizer parameters, comparison versions, time limits and Docker capacity.

Use the complete training set for initialization and paired batches by default. Record a sampling seed only when sampling is used. If no proposal count was supplied, choose and record a finite count within the declared training budget before launch; keep it fixed during learning. Ask only for essential inputs that cannot be resolved from the request, Project or Benchmark.

Fix an experiment/report version before launching. Prefer the user's specified versions; otherwise select and record the resolved versions of the runtime, benchmark, model and toolkit. Keep that configuration fixed through training and testing, and identify each measured Skill and Agent State by its frozen version.

Use the Train and Test tasks specified by the request and Benchmark instructions, keeping the runtime fixed across comparisons.

The configurable toolkit defaults are `beta2=0.9`, `base_budget=4`, `min_budget=1`, `variance_cap=0.1`; the budget counts unified-diff hunks. The default acceptance rule is strict improvement of mean normalized reward, without a per-case regression threshold. Use that gate when it matches the benchmark's declared rule; otherwise apply that rule and calculate volatility and the next budget independently of that decision. The dataset, benchmark organization, evaluation repetition count and proposal iteration count are experiment settings supplied by the prompt or Benchmark, not properties of SkillAdam.

## Apply SkillAdam

1. **Prepare.** Follow [initialization](references/initialization.md) to record the resolved plan, make a base State, and prepare the training State(s) according to the user's requested experimental design and the Benchmark's runtime contract.
2. **Learn.** Launch the training environment described by the Benchmark and give its Target the learner instructions and training brief through the supported State handoff. Complete the requested proposal iterations inside that continuing Session and environment.
3. **Collect and freeze.** Collect the last accepted Skill, answers, measured scores, decisions and optimizer history. Freeze the complete Skill folder, including supporting files. If no candidate was accepted, the initial Skill is the final result.
4. **Evaluate.** Follow [evaluation and reporting](references/evaluation.md) and the user's requested evaluation schedule (which benchmarks/splits to evaluate, which frozen States such as base and final to compare, and how many evaluation runs to perform). Every evaluation attempt starts from the corresponding frozen State in a fresh environment and conversation, with the same model, thinking level, tools and scoring conditions. Do not retrain or carry answers, memory or conversation history between evaluation attempts.
5. **Report.** Follow [evaluation and reporting](references/evaluation.md). Collect native results, versions, the training curve, costs, elapsed time and token usage; publish to the Project's Evaluation Center when applicable.

You own scheduling. When `run_subagent` is available, workers can launch and collect trials: one training worker owns a whole learning run, and a test worker owns one held-out case in one test repetition. Give each trial a separate working directory and output path. A worker does not start another experiment controller. Use the supported background mechanism, retain job identifiers, collect completions and fill available capacity until the requested work is done.

Count every container started for this experiment, including network sidecars, toward the user's Docker limit, and respect the benchmark's per-host limit. Leave unrelated workloads unchanged. Keep a short index of completed, active and pending work with artifact paths. A process launch is not a completed measurement; inspect the runner's final result before recording a score.

## Report the result

Use [the common report fields](references/evaluation.md#common-report-fields): `baseline` and `final` for test comparisons, `run` for complete test repetitions, and numbered `step` records for learning progress. Record versions and cost, time and token categories per training unit and test-case repetition.

Use `curve_kind: benchmark_score`. Keep current and candidate measurements, acceptance decisions, retained-Skill scores and optimizer state. A rejected candidate still contributes evidence; do not replace measured fluctuations with a cumulative maximum. Keep the final training verifier's grade separate from the online learning curve.

The optimizer's paired-case variance controls edits. Test `std` instead measures variation across complete repetitions of one frozen State. Train and Test remain separate, and no intermediate-Skill Test comparison is required. Include incomplete runs, deviations and paths to the frozen artifacts.
