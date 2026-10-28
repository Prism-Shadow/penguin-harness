# Organize construction and repeated evaluation

The main Penguin owns the experiment plan, scheduling, collection and reporting. A worker
owns one construction role or one evaluation cell; it does not start another experiment
controller. Use the published Benchmark and its native runtime instructions.
Follow `result-records.md` for the fixed experiment/component versions, metric definition,
virtual training curve and per-invocation USD/time/token records. Collect those records
throughout execution, including failures, rather than attempting to reconstruct them from
scoreboard averages at the end.

## One construction, three test repetitions

For each selected Benchmark or independent training unit, prepare one clean Target from
the common base configuration and construct one OpenSkill library. Record the base State,
selected packages and Case ids, source commit, model, thinking level, limits, installed
Skill hash and output paths before launching. Keep separate Targets, libraries and journals
for independent units; never feed one unit's learned library into another unit's baseline.
Within a unit, each construction Case keeps its own persistent creator and fixed skill plan.

The default `runs: 3` means three complete evaluations of each frozen State. It does not
mean three construction campaigns, three candidates, three virtual tests or three trials
of a continuous-training wrapper. An explicit user count overrides this default. Preserve
the Benchmark manifest unchanged and record both its published count and the chosen count
in the binding. If the user explicitly requests independent learning repeats, keep those
campaigns separate and label their variability separately; do not pool different learned
libraries into a same-State repetition matrix.

The order is:

1. Resolve the native bindings and prepare the baseline snapshots without scoring them.
2. Complete research, skill authoring, fresh practice, independent virtual verification
   and any evidenced feedback revisions for each construction Case. Each Case has the
   declared 360-minute default budget and existing attempt/recovery limits.
3. Freeze every selected unit's final library before any target scoring in this campaign.
   Prepare its Baseline and final State archives and record their versions and digests.
4. Evaluate Baseline and final on the same complete evaluation set with repetitions
   `1..runs`. Reuse the exact State archive for all repetitions of that variant. Each
   cell starts a fresh Target conversation and task environment without prior answers,
   memories or mutable workspace contents. Verify State bytes before and after dispatch.
5. Collect the complete matrices, publish native records and calculate repetition statistics.

Construction is performed once; feedback-driven revisions remain part of that construction.
OpenSkill keeps virtual feedback and last-revision export. It does not adopt a real training
judge or SkillAdam's candidate acceptance. A grouped GDPevo Train Case still includes all
its public questions; it does not provide a scored Train learning curve here. Report virtual
measurements, actual revisions and stopping evidence instead. Test feedback never reopens
construction or selects an earlier library. Baseline and final are the default comparisons;
do not add an S0 comparison merely because another method has one.

With T evaluation Cases, R repetitions and Baseline plus final, a unit needs `2 × T × R`
Target executions after freeze. For five held-out Cases and three repetitions that is
30 evaluations, plus the one construction process. An explicitly requested reader control
adds `T × R`. Declare the total across all selected units before launch.

## Schedule and resume

Use `run_subagent` / `input_subagent` and the host's supported background mechanism.
Construction roles still run through the isolated executor. An evaluation worker receives
the selected source commit, actual native task path, fixed State archive, complete runtime,
Case id, repetition index and unique job/output path as `evaluation.md` and `harbor.md` specify.
The `run` field is the whole-test repetition index, not a retry counter.

Use one shared capacity limit across units, including construction roles, business containers
and network sidecars. Respect the user's limit and the native Benchmark's per-host cap.
Two live States of the same Target cannot be evaluated simultaneously. Independent Targets
may run concurrently. A repetition is a logical grouping: cells from different repetitions
may overlap if each has an independent environment and the State remains frozen.

Keep a controller-owned `experiment-index.json` in the campaign scratchpad. Index every cell
by unit, variant, Case id and repetition, with its State digest, job/session id, status and
artifact path. Track pending, active, completed and failed work. Save construction journal
paths and the freeze record for each unit. A process launch or an idle worker is not a result;
read its native completion and scoring evidence. Keep abandoned attempts and their costs.

On resume, reconcile that index with journals, Traces and native trial results. Reuse valid
completed cells and collect active work; do not retrain or rerun complete matrices. A worker
formatting correction resends the same result. Repair and retry only an identified cell
whose evidence proves the Target never started, under the native retry rules. A measured
zero is valid; a missing grade is incomplete. Do not repeat low scores until one improves.
Construction STOP fences and recovery budgets keep the rules in `executor.md`.

## Validate, calculate and publish

Keep worker results in the existing journal matrix format:

```json
[
  { "variant": "baseline", "benchmark_id": "<test-id>", "cells": ["<worker JSON objects>"] },
  { "variant": "final", "benchmark_id": "<test-id>", "cells": ["<worker JSON objects>"] }
]
```

Replace the placeholder strings with protocol objects from `evaluation.md`. Each matrix
must contain every selected Case at every declared repetition, measured from the version
and digest in `begin-evaluation.states`. Each trial/session id must be unique across all
cells and variants. A matrix may carry `state_sha256`; if present it must match the journal.
The controller must also verify the actual archive and execution identity; declared metadata
alone cannot prove that the runner used it.

After collecting all variants for a unit, run this read-only helper:

```bash
python3 "<skill_dir>/scripts/evaluation_results.py" report \
  "<OUT>" "evaluation-matrices.json" \
  --measurements "measurements.json" \
  --time "<UTC measurement timestamp>" --summary "<public result summary>"
```

It requires the frozen journal, unchanged library, recorded measured States and complete
matrices. It validates cell identity, protocol, score, duration, nullable cost and unique
trial ids. Save its JSON in the experiment output. Each `matrices[].scoreboard_record` is
one standard Evaluation Center record; append that object under the paired Benchmark's
`evaluations`, preserve existing records and re-parse to verify it. On resume, reconcile
the existing record by State and trial ids rather than appending a duplicate. Then submit
`finish-evaluation` with `outcome: complete` and the original matrix record path.

No new scoreboard fields are needed: its `cases[].runs` hold the three measurements, while
the public summary states the sample SD. Detailed statistics stay in the report JSON.
Never publish a partial matrix as a completed result. Show missing cells in progress reports
without giving the incomplete campaign a final score or treating missing results as zero.

For a mean-score Benchmark with N Cases and R repetitions:

```text
repeat_score[r] = sum_q score[r,q] / N
mean = sum_r repeat_score[r] / R
sample_variance = sum_r (repeat_score[r] - mean)^2 / (R - 1)
sample_std = sqrt(sample_variance)
```

For repetition scores 60, 70 and 80, report `70 ± 10`. Keep full precision through aggregation;
round only display values and the native scoreboard fields. Scores and SD are on the
`0..100` scale (SD in percentage points); variance is in squared percentage points. With
R=1, sample SD and variance are `null`/unavailable, not zero. These statistics describe test
variation of the same frozen State, not the stability of independently learned libraries.

Also retain each Case's R scores, mean, sample SD and sample variance. The mean of those
Case variances is a separate diagnostic (`mean_case_sample_variance`); it is not the
variance of the whole-test score. Never average Case SDs for the headline statistic.
This helper implements the native equal-Case mean. If a selected Benchmark requires another
aggregation rule, report that unsupported rule before execution instead of silently applying
equal weighting or rewriting its scorer.

For several Benchmarks on this common scale, predeclare their evaluation ids and journal paths:

```json
{
  "benchmark_ids": ["<test-a>", "<test-b>"],
  "experiments": [
    { "out": "<absolute OUT-a>", "record": "evaluation-matrices.json", "measurements": "measurements.json" },
    { "out": "<absolute OUT-b>", "record": "evaluation-matrices.json", "measurements": "measurements.json" }
  ]
}
```

Run `evaluation_results.py aggregate <campaign.json> --time <UTC> --summary <public-summary>`.
It requires every selected Benchmark with the same runtime, variants and repetition count,
reads the original journal-bound matrices, and refuses reused trial ids. For each variant,
average Benchmark scores within repetition 1, likewise for 2 and 3; then compute the overall
mean and sample SD of those three scores. Benchmarks have equal weight even when their Case
counts differ. Do not average Benchmark SDs. The overall record belongs in the campaign
report, not a fabricated Benchmark scoreboard.

Report construction and evaluation separately. `scored_trial_cost` describes scored cells
only. The resource ledger supplies the wider Train/Test/controller totals, including failed
attempts, and deduplicates underlying requests as `result-records.md` specifies. Native
scoreboard cost/duration fields are averages. `summed_trial_duration_ms` is not elapsed wall
time when workers overlap; record campaign start/end and actual wall time separately.
Link State archives, freeze records, bindings, matrices and actual trial/Trace paths.
