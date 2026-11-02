---
name: skilladam-training
description: "Run SkillAdam on the supplied training tasks in a continuing Session: initialize a Skill from execution feedback, evolve it with an issue tracker and adaptive edit budget, then export the learned Skill."
version: 2026.10.29.4
---

# Train with SkillAdam

[SkillAdam: Stable and Efficient Skill Evolution for Agents](https://arxiv.org/abs/2609.08944v1), §4 and Algorithm 1, learns a reusable Markdown Skill while keeping the model and tools fixed. The [author implementation](https://github.com/ruc-datalab/SkillAdam/tree/b6c9640f7a9e0d5e3a500c25bc4e6369eeca78f1) is the implementation reference.

You are the training Target Agent for one training unit. Read `training-request.json` in your Agent State and the supplied `benchmark-training.md` beside this Skill, then complete one whole learning run, including all requested proposal iterations, in this continuing Session and benchmark environment. Manage the task attempts, feedback, candidate Skills and optimizer state yourself, without waiting for another agent to direct each iteration.

The **working Skill** is the task-solving document you produce and improve; it is separate from these method instructions. A **rollout** is an attempt to solve the training tasks using a specified working Skill. In the paper, the target agent is the role performing that rollout. You may use task-focused model calls within the same container; your continuing training Session retains the learning history.

## The idea

Start with task executions and their feedback, and use them to write an initial Skill. Repeatedly observe how the current Skill performs, propose an edit, and evaluate the candidate on the same training cases. A benchmark-specific acceptance rule determines whether to retain it.

SkillAdam carries two kinds of information between iterations:

- **Evolving Issue Tracker (EIT): what to change.** Remember recurring problems, attempted fixes and their outcomes. Link new failures to previous issues, preserve useful corrections, and reopen an issue when it recurs. This is the paper's analogue of Adam's first-moment memory.
- **Adaptive edit budget: how much to change.** Measure the variance of the candidate's per-case score changes, and maintain an exponential moving average. Uneven effects reduce the next edit budget; consistent effects allow it to recover. This is the second-moment analogue. Low variance alone does not imply an improvement, so the acceptance rule remains necessary.

The algorithm changes text, not model weights. Feedback consists of trajectories and evaluation metrics, with diagnostic text when available. Reference answers are not required.

## Before you start

Resolve the training tasks, feedback interface, working-Skill location, fixed model/tools, batch size and iteration budget from the training request and benchmark instructions. The task set and number of rounds belong to the experiment; SkillAdam does not prescribe a benchmark, grouping or split.

Record the parameters before training: sampling seed when sampling is used, maximum proposal iterations, `beta2`, `base_budget`, `min_budget`, `variance_cap`, and the benchmark's acceptance metrics and thresholds. The toolkit uses `beta2=0.9`, `base_budget=4`, `min_budget=1`, `variance_cap=0.1` as configurable defaults. A budget counts edit regions (hunks) in a unified diff.

Use the supplied benchmark's input locations, feedback API or command, metric definitions and export paths. Keep this Session and environment throughout learning; do not start Harbor trials between tasks or candidates.

## Initialize

1. Run the initialization tasks without a learned working Skill. Save the answers, trajectories and evaluator feedback as the raw baseline.
2. From that evidence, write an initial Skill: reusable procedures that explain successful approaches and address observed failures. Give it a stable Skill name, description and version in YAML frontmatter. Preserve the complete Skill folder, including supporting files, as the initialization result.
3. Set the EIT to an empty issue list, the running variance `V` to zero and the first edit budget to `base_budget`.

Task-specific answers belong in rollout records. The Skill should describe how to solve future tasks.

For task-focused rollout calls, a fresh `run_subagent` call can receive the selected tasks, tool instructions and exact working Skill with a distinct output directory. Keep the model and thinking level fixed, give a no-Skill rollout no learned document, and use a separate answer directory for each rollout. A rollout solves its assigned tasks; it does not start another training loop. Obtain feedback on the new answers after the attempt; regrading an old answer does not measure a new Skill. These calls share the existing container and filesystem while the continuing training Agent retains the learning history.

## Observe, propose, evaluate

For each proposal iteration, begin with the last accepted Skill and optimizer state from the preceding iteration.

1. **Observe.** Select the training batch using the experiment's sampling rule. Run the current Skill on these cases and collect trajectories and per-case feedback. A full batch is appropriate when the experiment uses the whole training set.
2. **Propose.** Use the current Skill, this batch's evidence, the EIT and current edit budget to propose one candidate. Explain the observed problem the edit addresses. Keep the proposed diff and its rationale. The proposer may be a fresh model call supplied with these inputs; it needs no separate benchmark environment.
3. **Evaluate.** Run the candidate on exactly the same cases with the same model, tools and evaluation conditions. Obtain new answers and real evaluator feedback; editing a Skill does not itself create a new score.
4. **Decide.** Apply the benchmark's declared acceptance rule. Retain an accepted candidate; otherwise keep the previous Skill. The paper permits designated improvement metrics and protected metrics. It does not mandate a per-case regression threshold.

A null, invalid or unchanged candidate consumes a proposal iteration while leaving the Skill, EIT, variance and budget unchanged, following Algorithm 1's null-candidate branch. Save the reason. For valid evaluated candidates, continue with the state updates below whether the candidate was accepted or rejected.

## Carry the evidence forward

Update the EIT from the previous tracker, current rollout evidence, proposed edit, candidate feedback and acceptance decision. Each issue records a problem, its status and the history of attempted fixes with their outcomes. A rejected candidate still supplies evidence about an attempted fix. Describe resolution on the Skill actually retained.

For each paired case, let `delta` be candidate score minus current-Skill score. Compute:

```text
batch_variance = sample_variance(deltas)   # denominator n - 1; zero if n < 2
V = beta2 * previous_V + (1 - beta2) * batch_variance
next_budget = max(min_budget,
                 round(base_budget * (1 - clip(V / variance_cap, 0, 1))))
```

Calculate these quantities from paired scores on the same normalized scale (for a `0..100` score, divide by 100 before using these default parameters). Use the experiment's parameters and the saved running variance from the preceding iteration. Save the retained Skill, updated EIT, `V` and `next_budget` for the next iteration.

The default acceptance rule is strict improvement of mean normalized reward. Use it when the Benchmark defines that comparison; otherwise apply its declared improvement and protected metrics. Acceptance and the variance update are separate decisions: a uniformly harmful edit has low variance but must not be accepted as an improvement.

## Keep the learning record

Save the no-Skill answers, feedback and trajectories; the initial Skill folder; each current/candidate rollout, proposed diff and decision; and the EIT, variance and budget after each iteration. Keep complete feedback responses alongside their numerical score maps. Include exact artifact paths in a compact index so the controller can collect them. Use the export directory supplied by the benchmark and training request.

A useful layout is `stage0/`, `initial-skill/`, `iterations/001/`, `state.json` and `summary.json`. These names are organizational choices, not additional acceptance conditions. Record the initial Skill's first measured training score and each iteration's retained-Skill score; do not replace fluctuating measurements with a cumulative best score. If the experiment requests an initial Skill training score, measure it even when no proposal iterations are requested.

## Freeze and report

Return the **last accepted Skill** after the configured iterations. Preserve the initial Skill, every proposed edit, its measurements and decision, and the tracker and budget history. Export the complete retained Skill folder and the requested final training answers. Use answers from that Skill's measured rollout; if it covered only a batch, complete any remaining required answers with the same retained Skill. The experiment controller will freeze these artifacts and arrange held-out tests in separate environments. Test feedback is not an optimization input.

Report training coverage and changes, initialization and optimization effects separately, accepted/rejected proposals, costs where recorded, artifact paths and any unfinished work or departures from the requested method. This run's Skill and optimizer history belong only to this training unit. The controller reuses the frozen result for repeated tests after learning ends.
