---
name: evo-harness-rsi-toolkit
description: "Run Evo on selected Project Benchmarks: one training pass, negative-feedback reflection in the original Solver Session, one batch compilation, then repeated frozen baseline/final evaluation."
version: 2026.10.29.1
---

# Evo-Harness

You are the experiment controller.

## Before you start

If the message only names this Skill, ask which experiment to run. An explicit
experiment request authorizes the workflow below.

Resolve the requested Benchmark by name or
package path from the current Environment's App Data Dir. Prepare its resources using [setup](references/initialization.md).
Read its manifest,
Case statements and linked run instructions. Use its declared Train/Test split,
task sources, adapter and scoring. A name is sufficient when its package is
installed; do not ask the user to supply a source link already in the package.

Record the requested model, thinking level, budget, resource limits and source
versions. Use the current Environment's provider/model pair when unspecified.
Reuse the Project's saved connection through the supported runner; do not read
keys or server tokens into prompts. Resolve missing required inputs together.
Assign an experiment version before launch. Use the complete selected splits
unless the user selects otherwise. Train once per domain or independent unit;
freeze its result and test both baseline and final three complete times by default.

## Learning method

The [method reference](references/method.md) records the `.6` adaptation. Keep
the model, tools and pre-batch library fixed while every training task receives
one Solver attempt and one real grade. Negative feedback is reflected upon in
that original Solver conversation. Success produces no candidates; infrastructure
failure is incomplete work, not a zero score.

After the entire batch, one independent Evolver reads all candidates, all
authorized training contexts and the complete private library. It chooses
ADD/MERGE/REVISE/SKIP once per candidate per level. General and topic levels
each have a ceiling of five entries (five per topic). The complete exported
package fits 16,000 UTF-8 bytes. Every task receives all general descriptions
and all bodies matching its topic, without selection or truncation. General
bodies remain private. Do not add candidate retests, score gates, positive-source
candidates, a second learning pass or SkillAdam's optimizer.

## Complete the experiment

Use the [common report fields](references/evaluation.md#common-report-fields): `baseline` and `final` for the two frozen States, `run` for test repetitions, and `mean`, `std` and `final_minus_baseline` for the comparison. Keep training stages separate from test repetitions.

1. Follow [setup](references/initialization.md). Resolve the native source once,
   keep its actual commit, prepare a common base and separate training State,
   and confirm original-session feedback before spending the training budget.
2. Give the training Target [training.md](references/training.md), the complete
   [roles](references/roles.md), the helper and a train-only benchmark brief.
   Launch the documented continuous training task once. The learner coordinates
   its Solvers and the batch Evolver inside that Session and environment.
3. Collect native traces, real feedback, candidates, decisions, private library
   and the exported Skill package. Verify original Solver identities, one grade
   per task, complete feedback observation and one final Evolver. An invalid
   trace remains a method deviation even if its score is present.
4. Construct baseline and final test States from the common base, adding only the
   frozen learned package and exact topic context to final. Freeze both before
   testing. Each test case and repetition starts in a fresh environment and
   Session. Keep histories, answers, training instructions and private library
   out of both States. Test feedback never changes the learned package.
5. Follow [evaluation](references/evaluation.md) to launch all held-out cells,
   collect native results and publish complete Evaluation Center matrices.
   Retain every case score and per-trial usage, plus source versions and State digests.

Use existing managed background tools to launch workers and collect completions.
Retain job IDs and output paths across compaction. Launch workers within the
benchmark and user's container limits, counting sidecars. Keep unrelated jobs
untouched. Do not report completion while a requested trial is pending. Repair
formatting in the same worker from its existing result, without repeating a
graded attempt. Report concrete missing capabilities or failed jobs.

The scripts validate artifacts, not model behavior or tool permissions. Native
trace review supplies evidence of the instructed learning process. Do not claim
that local helper tests prove a paid autonomous experiment passed.
