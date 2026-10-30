---
name: skillopt-training
description: Train one reusable Skill with SkillOpt using trajectory reflection, bounded patches, a fixed selection gate and epoch-wise slow/meta updates in a continuing environment.
version: 2026.10.30.1
---

# Train with SkillOpt

You are the training Agent. Read `training-request.json` at your Agent State root and `benchmark-training.md` beside this Skill. Complete the learning run in this continuing Session and environment. The outside controller handles deployment, collection and independent Test evaluation.

The **working Skill** is the solving document you improve, separate from these method instructions. The **Target** executes tasks with that document. The **optimizer** interprets trajectories and proposes changes. You manage these roles with existing Penguin tools; a task-solving call does not start another training loop. Keep Target model, thinking level, tools and task instructions fixed. Use the requested optimizer model, or the selected Target model when none is specified, and record that choice.

Method references are [SkillOpt](https://arxiv.org/abs/2605.23904v1), §3 and Appendix C, and the [author implementation](https://github.com/microsoft/SkillOpt/tree/bc0a392ef0a7f92840ec673d80204d34ced169d0). The method controls the size and acceptance of text changes; it does not train model weights.

## Prepare the data and state

Use all supplied Train tasks for learning. Prefer a separately supplied validation set for selection. If none exists, use all Train tasks, or the fixed Train subset requested by the experiment, as the selection set **without removing any of them from learning**. Fix its IDs, metric and aggregation before optimization. Record `selection_source` as `validation`, `train_all` or `train_subset`, and keep overlapping scores labeled as training-set selection. Never use held-out Test feedback.

Resolve epochs, batch sizes, edit schedule, optimizer settings, stopping budget and output locations from the request. Default to four epochs, rollout batches of at most 40, reflection minibatches and merge batches of at most eight, and up to three analyst refinement passes per minibatch. Each epoch covers every Train task; keep the last partial batch. Record any shuffled order and seed. Choose up to 20 fixed Train tasks for comparing epoch checkpoints.

Use the supplied starting Skill when present. Otherwise author a concise draft from public task and tool descriptions. Preserve useful procedures; keep instance answers in execution records. Save the initial document with normal Skill frontmatter and evaluate it on the complete selection set. This initializes `current` and `best`, their measured scores and immutable snapshots. It is a learning checkpoint, not an additional required Test variant.

Maintain an epoch-local rejected-step buffer, a persistent optimizer-only meta guidance document and end-of-step Skill snapshots for each epoch. Reset the rejected-step buffer at the start of each epoch; retain the archive for reporting.

## Execute and reflect

For each batch, execute every task using the current accepted Skill and collect the actual answers, trajectories, tool observations and authorized evaluator feedback. Freeze that Skill during the batch. Fresh task-focused Sessions can share the existing business container; they receive public task inputs, the exact Skill and their own output location, without prior answers or optimizer history. Keep the training coordinator's Session alive throughout.

Preserve task order when the environment is stateful. Follow any documented reset or state-preparation contract without restarting the training container. Record state carryover when tasks cannot be independently replayed; fresh conversations alone do not create independent environments. A new candidate evaluation must execute the tasks again, not reuse earlier answers.

Separate successful and failed trajectories using the Benchmark's success criterion. Keep fractional scores and diagnostic detail even when a task is not fully successful. When no success flag exists, fix a documented success rule before training; do not replace the primary continuous score with that binary grouping.

Reflect on each group's minibatches separately. Failure analysis identifies missing or misleading procedures; success analysis identifies what should be preserved or generalized. Supply the current Skill, relevant trajectories, the epoch's failed-edit record and persistent meta guidance. Analyst refinement revisits the diagnosis and proposed edits; it does not grant extra answer attempts or candidate score retries.

Record proposed changes as add, delete or replace operations with their location, new text, rationale and supporting task/trace IDs. A useful change explains a reusable action, tool policy or check. Do not put instance-specific solutions into the Skill.

## Merge, rank and patch

Merge failure proposals and success proposals separately, in groups of up to eight when needed, then merge the two pools. Give failure corrections priority while preserving effective behavior. Remove duplicate, contradictory and task-specific edits. Rank the remaining edits by expected benefit supported by the traces.

The textual learning rate is a maximum number of edit operations, not a token or diff-line quota. With `T` planned fast-update steps and one-based step `t`, use the implementation's cosine schedule:

```text
L_t = max(L_min, round(L_min + (L_max - L_min) * (1 + cos(pi * t / T)) / 2))
L_max = 4; L_min = 2
```

For a one-step run use `L_max`. Round to the nearest integer, ties to even. Set `T = epochs × ceil(train_task_count / rollout_batch_size)` before starting; slow/meta updates are separate from these fast steps. For four fast steps the default budgets are 4, 3, 2, 2.

Apply at most the top `L_t` edits as localized patches. There is no minimum number of changes: an empty useful proposal pool leaves the Skill unchanged. Preserve unrelated text and the protected slow-update section. Save the parent Skill, proposed edits, resulting candidate and their digests. Patch mode is the default; do not silently replace it with whole-document rewriting.

## Select a candidate

Run the candidate on every fixed selection task with the same Target configuration and score aggregation used for the current checkpoint. Compare the complete candidate score against the stored score of the current accepted checkpoint. Accept only a strict improvement; ties retain the current Skill. Update `best` when the accepted candidate exceeds its score. This gate uses the primary aggregate score, not a per-question majority or an averaged standard deviation.

Keep rejected candidate measurements. Add the attempted edits, observed failure patterns and score change to the current epoch's buffer so later proposals can use that evidence. A missing or broken evaluator result is not a measured failure; follow the runtime's permitted recovery and retain the last fully measured checkpoint.

The paper's gate compares a new candidate against the previously measured current Skill. Do not add paired incumbent retests, best-of-many retries or a variance-adaptive acceptance rule from another algorithm. If the candidate is unchanged, retain the existing measurement rather than describing it as a new measured sample.

## Slow and meta updates

Save each epoch's end-of-step Skill before slow updating. From epoch two onward, execute the previous and current epoch's end-of-step snapshots on the same fixed comparison tasks. Group the observed transitions into failure-to-success, success-to-failure, persistent failure and persistent success. Retain partial-score changes as well. Use these paired trajectories to identify lasting improvements, regressions and unresolved problems.

Produce two distinct outputs:

- **Slow guidance for the Target.** Propose a concise set of general execution lessons in the Skill's protected `<!-- SLOW_UPDATE_START -->` / `<!-- SLOW_UPDATE_END -->` section. Fast patches leave this section intact. Evaluate this changed Skill on the complete selection set and accept it only through the same strict gate. Rejection retains the prior document and adds the outcome to the rejected-step record.
- **Meta guidance for the optimizer.** Update a separate document about productive edit strategies, failed directions and persistent failure modes. Feed it to later reflection, merging and ranking. It stays in the learning record and is never installed in the solving State.

Use no fabricated epoch comparison in epoch one. Continue with the accepted Skill and updated optimizer memory until the declared budget ends. The first epoch may create an empty protected section for later guidance.

## Export and report

Export the complete best accepted Skill folder, its version and digest, and any answers required by the Benchmark. Keep its accepted slow guidance. Exclude optimizer meta guidance, rejected-edit history, answers and trajectories from the learned Skill itself.

Retain a learning history with numbered `step`, `native_stage`, epoch, task IDs, measurement role (`rollout`, `selection` or `slow_comparison`), Skill identity, scores, edit budget, proposals and accept/reject decision. Store candidate scores separately from retained-checkpoint scores. Use `curve_kind: benchmark_score`; the fixed selection set gives a comparable optimization curve, while different rollout batches must remain identifiable. A final native verifier grade is a separate measurement.

Record cost, time and token categories for the whole training unit, including reflection, candidate selection and slow/meta work. No sample standard deviation across training runs exists when training only once. The controller evaluates the same frozen `baseline` and `final` three times and owns the Test statistics.

## Adaptation notes

The paper separates Train, selection and Test. Reusing Train for selection is an explicit fallback for benchmarks without validation data; it preserves all learning examples and does not provide an independent validation estimate. Batches and slow-comparison sets shrink to available data, and execution follows the Benchmark's continuous-environment contract.

The reference implementation also offers ungated slow-update injection. This toolkit follows the paper's selection-gated slow update, equivalent to `slow_update_gate_with_selection=true`. Analyst, merger and ranking roles can run sequentially within the available budget; their evidence flow stays the same.
