---
name: evo-harness-rsi-toolkit
description: "Run Evo-Harness on selected Project Benchmarks: reflect on negative feedback in the original Solver Session, compile one batch of reusable Skills, then evaluate frozen baseline and final."
version: 2026.10.29.4
---

# Evo-Harness

You are the experiment controller. Read the selected Project Benchmarks, prepare the learning environment, collect the learned Skills and arrange independent testing.

[Evo-Harness](https://arxiv.org/abs/2608.15071v2) turns execution feedback into reusable methods. Each Solver answers one training task and, on negative feedback, reflects in that same conversation. After the whole batch, one independent Evolver compiles those lessons into a Skill library. Model weights and tools stay fixed. [Method and provenance](references/method.md) describes the source implementation and this adaptation.

## Before you start

If the request only names this Skill, ask which Target and Benchmark to use. Resolve supplied experiment details from the request and Project before asking for anything else.

Follow [initialization](references/initialization.md). Resolve the selected Benchmark's Train/Test packages, task-source commit, runtime, feedback and export contracts from its installed manifest and Case Markdown. An installed name is sufficient; the user need not provide a repository link.

Record the experiment version, model, thinking level, base State, training roster, topic, budgets and resource limits. Prefer user-specified versions and settings. Use all declared Train and Test questions unless a subset is requested.

Train once per independent benchmark or training unit. Learning requires the real training feedback to reach the original Solver Session. A verifier that runs only after that Session has been lost cannot support this reflection step; report the missing capability.

## Learn one batch

Give the training coordinator [training.md](references/training.md), [roles.md](references/roles.md), the resolved settings and a train-only benchmark brief. Launch the documented continuous training environment once. The coordinator retains the training Session and arranges the roles inside that environment.

1. **Solve.** Each task receives one Solver attempt and one real grade. Every Solver uses the same frozen pre-batch library.
2. **Reflect.** Negative feedback is analyzed in that original Solver conversation, with its actual trajectory. Successful tasks produce no candidates. A scoring failure is incomplete work, not negative feedback.
3. **Compile.** After all tasks, one independent Evolver reads all candidates, authorized training contexts and the complete private library. It chooses ADD, MERGE, REVISE or SKIP for each candidate at each applicable level.
4. **Freeze.** Export the resulting library once. Do not add candidate retests, score-based acceptance gates or another learning pass.

Keep at most five general entries and five entries per topic. The complete exported package has a 16,000-byte UTF-8 limit. These are ceilings, not quotas. Solvers receive every general description and every body matching their topic, with no selection or truncation. General bodies stay in the private learning record.

## Test and report

Build baseline and final test States from the same saved base. Give both the same fixed reader; baseline has the pre-learning library and final has the frozen learned library. Add only the exported methods and exact topic context to final. Do not transfer answers, private general bodies, training instructions or learning history.

Follow [evaluation and reporting](references/evaluation.md). Test each frozen State on the complete held-out set three times by default. Every case and repetition uses a fresh environment and conversation; all repetitions reuse the same library. Test feedback never changes it.

Use `baseline`, `final`, `mean`, `std` and `final_minus_baseline` in reports, with versions and per-unit/per-case cost, time and token records. Preserve training task scores, negative reflections and compilation decisions. Evo-Harness has one learning batch, so use `curve_kind: none` rather than inventing an iterative training curve.

Use Penguin's supported delegation and background tools to schedule and collect work. Keep job IDs and artifact paths, respect the shared container limit including sidecars, and report missing results or deviations from the method.
