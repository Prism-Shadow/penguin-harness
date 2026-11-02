---
name: skillopt-rsi-toolkit
description: Run SkillOpt on selected Project Benchmarks by learning bounded Skill edits from trajectories, selecting candidates on fixed evaluation tasks, and testing frozen baseline and final States.
version: 2026.10.30.1
---

# SkillOpt

You are the experiment controller. Read the selected Project Benchmarks, prepare a continuing learning environment, collect the learned Skill and arrange independent testing.

[SkillOpt: Executive Strategy for Self-Evolving Agent Skills](https://arxiv.org/abs/2605.23904v1) treats Skill text as the object of optimization. The Target solves tasks with its current Skill; an optimizer reflects on successful and failed trajectories, merges proposed edits and applies a small, scheduled edit budget. A candidate replaces the current Skill only when its selection score improves. Rejected edits inform later proposals, while epoch-wise slow/meta updates retain longer-term lessons. The model weights and solving tools stay fixed.

The output is the **best accepted Skill**, including any accepted slow-update guidance. Optimizer memory and training answers stay in learning records. [Training instructions](references/training.md) describe the algorithm and its adaptations.

## Before you start

If the request only names this Skill, ask which Target and Benchmark to use. Resolve supplied experiment details from the request and Project before asking for anything else.

Follow [initialization](references/initialization.md) and the [installed Benchmark instructions](references/benchmark.md). Resolve Train/Test packages, task-source commit, runtime, feedback and export locations from their manifests and Case Markdown. An installed Benchmark name is sufficient.

Use all declared Train and Test questions unless a subset is requested. Train once per independent benchmark or training unit. Record the Target Agent, model, thinking level, experiment version, optimizer configuration and resource limits. Prefer user-specified settings. The Target is separate from this experiment controller; the training Agent organizes the learning roles inside the training environment.

| Setting | Default |
| --- | --- |
| Training runs per independent unit | 1 |
| Epochs | 4, covering all Train tasks in each epoch |
| Rollout batch | Up to 40 Train tasks |
| Reflection minibatch / merge batch | Up to 8 trajectories / proposals |
| Analyst refinement | Up to 3 passes per reflection minibatch |
| Textual edit budget | Cosine decay from 4 to 2 edits |
| Slow/meta comparison | Up to 20 fixed Train tasks at epoch boundaries |
| Complete Test repetitions per frozen State | 3 |

Cap batch sizes at the available tasks. These defaults adapt the paper's optimization settings to the selected data; they do not require a particular benchmark, model provider or Docker image. Fix the finite learning budget before launch and honor the Benchmark's runtime limits.

## Choose the selection tasks

Use an independent validation set when the Benchmark supplies one. Otherwise, use **all Train tasks for both learning and candidate selection** by default. A requested fixed subset of Train may serve as the selection set, while every Train task remains available for learning. Do not remove those examples from Train.

Fix the selection task IDs and aggregation rule before the first candidate. Record whether the set is independent or overlaps Train; overlapping selection scores are training measurements, not held-out validation. The paper uses a separate selection split; reusing Train is this toolkit's compatibility policy. Held-out Test is used only after freezing and never selects a Skill.

## Learn and freeze

Give the training Agent [training.md](references/training.md), the resolved settings and a train-only benchmark brief, plus the authorized selection tasks. Start the documented continuous Train environment once. Keep the training Session and business container throughout the learning run; the training Agent manages its own iterations using Penguin's existing tools.

1. **Initialize.** Use a supplied starting Skill or write a compact draft from public training requirements. Evaluate it on the fixed selection set and save the first accepted checkpoint.
2. **Observe and reflect.** Execute a Train batch with the current Skill. Analyze successful and failed trajectories separately, using the current epoch's failed-edit record and persistent optimizer memory.
3. **Merge and edit.** Consolidate proposals, prioritize failure corrections, rank useful changes and apply at most the scheduled number of localized edits.
4. **Evaluate.** Solve the selection tasks with the candidate. Accept only a strict improvement over the current selection score; otherwise keep the current Skill and record the rejected changes.
5. **Consolidate.** From the second epoch onward, compare the previous and current epoch's end-of-step Skills on the same Train tasks. Propose compact slow-update guidance through the same selection gate and refresh the optimizer-only meta guidance.
6. **Freeze.** Finish the declared learning budget and export the best accepted Skill with its version, learning records and benchmark-required answers.

Fresh task-solving calls receive the exact working Skill and public inputs. The continuing training Agent retains optimizer history. Evaluating a changed Skill means producing new answers; regrading old answers does not measure it.

## Test and report

Build `baseline` and `final` from the same saved base State and fixed reader. Baseline is the pre-learning State; final adds the exported Skill. Follow [evaluation and reporting](references/evaluation.md): measure each frozen State on the complete Test set three times by default, with a fresh environment and conversation per case and repetition. Reuse the same learned Skill for every repetition.

Report `baseline`, `final`, `mean`, `std` and `final_minus_baseline`, plus versions and per-unit/per-case cost, time and token categories. Record actual rollout and selection measurements as numbered `step` records with `curve_kind: benchmark_score`; distinguish their task sets and retain rejected candidates. Intermediate Skill tests are optional. Test feedback never reopens learning.

Keep job IDs and artifact paths, respect the shared container limit including sidecars, and collect every requested result. Report incomplete work explicitly.
