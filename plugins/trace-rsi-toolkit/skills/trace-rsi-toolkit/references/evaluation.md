# Launch, collect and report

The outside Organizer owns scheduling and collection. Read the published Case instructions, linked README and adapter contract for exact commands. Use existing Penguin CLI, execution tools or evaluation workers; a worker handles one continuous training trial or one independent test cell, without creating another experiment controller.

## Common report fields

Use these names in the final experiment report so results from different RSI methods can
be compared. Keep native worker protocols, journals and `scoreboard.yaml` unchanged;
translate their fields when assembling the report, retaining the original artifacts.

| Field | Meaning |
| --- | --- |
| `method` | Toolkit method id: `skilladam`, `evo-harness`, `openskill` or `trace`. |
| `experiment_version`, `component_versions` | Stable report identity and the actual Harness, runner, Benchmark, model and toolkit versions. User-specified versions take priority. |
| `benchmark_id`, `training_unit_id` | Published evaluation Benchmark id and the independent unit that produced its learned artifact. Record the paired Train package separately; Train and Test are separate measurements of one experiment. |
| `phase` | `train`, `test` or `controller` for resource attribution. |
| `variant` | `baseline` for the pre-training State, `final` for the frozen learned State. Record any requested extra control by its own name. |
| `run`, `runs` | One-based complete-test repetition index and total repetitions, normally 3. A retry, training iteration or candidate is not another test repetition. |
| `state_version`, `state_sha256` | Measured frozen State identity; distinct from the experiment version. Map native `version`/`expected_version` here. |
| `repetition_scores`, `mean`, `std` | Every complete repetition's score, their mean and sample standard deviation with denominator `runs - 1`. One repetition gives `std: null`. |
| `final_minus_baseline` | Final Test mean minus baseline Test mean, in score units. Calculate from unrounded means. |
| `case_id`, `score` | Published case id and its measured score in each test repetition. Record the metric, scale and aggregation rule; call it accuracy only when the Benchmark does. |
| `cost_usd` | Measured USD for this record; native scoreboard `cost` has this unit but its aggregate fields are averages. |
| `started_at`, `finished_at`, `duration_ms` | Actual UTC timestamps and elapsed milliseconds at the same granularity as cost. |
| `tokens` | `cached_input`, `uncached_input`, `output`, `total_input` and `total`, in tokens. |
| `curve_kind` | `benchmark_score` for measured training scores, `virtual_validation` for proxy checks, or `none` when no iterative measurements exist. |
| `step`, `native_stage` | Zero-based training record order and optional original stage label. `step` is independent of the Test repetition `run`; `native_stage` maps back to original artifacts. |

Use `baseline` and `final` in result tables, even when the method calls its learned
artifact a bank or library. `baseline` describes the State saved before learning; its
measurement may happen after learning when the method requires that order. Record its
base configuration and any fixed reader in `baseline_definition`. Do not call it
“No Skill” if a user-supplied learned Skill was already present. `final` means the
method's exported result, which may be a training-selected checkpoint rather than the
last attempted revision. Record that selection separately.

Display training progress as `Step 0`, `Step 1`, and so on, with the recorded State or
artifact version. Keep method-specific names such as `S0`, `H1` and `B0` in `native_stage`
or raw records. A step orders observed training stages; it does not imply a new accepted
State or an improvement. Preserve current/candidate scores, acceptance decisions and
regressions where the method has them. When `curve_kind` is `none`, do not invent a curve.

For each Benchmark, and for the equal-weight overall result, include a comparison with
this shape (illustrative scores):

```json
{
  "baseline": { "repetition_scores": [60, 70, 80], "mean": 70, "std": 10 },
  "final": { "repetition_scores": [75, 80, 85], "mean": 80, "std": 5 },
  "final_minus_baseline": 10
}
```

For a case, compute statistics from its own repetition scores. For a Benchmark, first
aggregate all selected cases within each repetition; for overall, first average the same
selected Benchmarks within each repetition. Only then calculate `mean` and `std`.
Keep full precision until display. These are repeated-test means, not best-of-three or
pass@3. No intermediate-Skill Test comparison is required.

Retain one resource summary per complete training unit, including all its learned files,
and one record per Test `benchmark_id × variant × case_id × run`. Keep disjoint controller
usage and failed-attempt usage, separate Train/Test totals, and actual experiment wall time.
A library with several Skills has one shared training cost, not a repeated charge per file.
Missing measurements remain `null`; label incomplete totals. Keep the method's own training
stages and diagnostics alongside these common fields, without pooling virtual rates,
training scores or optimizer variance into Test `std`.

## Launch contract

Record benchmark/case, experiment and State version/digest, condition, repetition, runtime, native job/trial paths and process handle. For repository-backed experiments, organizer records live in the experiment's `jobs/` directory; Harbor-managed trials retain their native locations, normally the published Benchmark's `.jobs/`.

Launch training once per unit with the Curator State. After collecting its exports, launch the selected-bank and no-Skill test matrices with the corresponding frozen solver archives. All role launches explicitly bind provider/model/thinking and identity; confirm actual recorded settings. The two test conditions use the same task revision, capabilities, limits and repetition count.

Give repetitions stable indices before execution. A repetition contains one run of every test case; different repetitions may execute concurrently. Each test cell starts in its own fresh environment/session. Respect shared trial concurrency and total container capacity, including sidecars.

Record completion from native results and exported artifacts, not merely process launch or a successful shell exit. Workers return trial identity, result/artifact locations, native status, score, cost and timing evidence. Missing grading is missing, not an invented zero. Follow the benchmark's treatment of task failures and retries, retaining original attempts and linking any authorized replacement.

## Training handoff

Collect H1 and B0…BR task × A matrices, immutable submitted candidates, judge responses, action/selection trajectories, Curator analyses/proposals, stage bank snapshots and publication decisions. Check bank hashes and recompute selection using [training.md](training.md). Keep actual stage scores, including regressions; a running maximum is not a training curve.

Training uses one continuous run by default. Its within-batch task/attempt scores do not provide a standard deviation across independent training runs. Report stage mean, coverage and selected stage separately from the native training verifier score. The latter grades exported answers and does not prove all training phases ran.

Set `curve_kind: benchmark_score`. Map H1 and B0…BR to `native_stage`, displaying their recorded order as `Step 0`, `Step 1`, and so on. Export the selected checkpoint as `variant: final` in Test results. Neither H1 nor B0 is an extra required Test comparison.

Freeze `best_train` selection before reading held-out results. Test the exact exported snapshot. Keep training evidence outside the deployed bank and preserve all stages even when they are not tested.

## Test scores and uncertainty

Follow the benchmark's score scale. For GDPevo convert native rewards in [0, 1] to percentages. Retain unrounded per-case, per-repetition scores; round only displayed results.

For N cases and K complete repetitions, let x(i,r) be case i's score in repetition r:

```text
m(r) = sum_i x(i,r) / N
mean = sum_r m(r) / K
sample SD = sqrt(sum_r (m(r) - mean)^2 / (K - 1))
```

Report `mean ± sample SD` over complete repetition means, as required by the benchmark. For five cases and three repetitions, first obtain three five-case means, then compute their mean and sample SD with ddof=1. Do not average per-case SDs, substitute propagated per-case variances or label SE as SD. For K=1, SD is unavailable.

A per-case row may show that case's mean and sample SD across its K trials. When reporting an equal-weight macro-average across benchmarks, first average benchmark means within each repetition, then compute SD across those aggregate repetition means. Label any alternative weighting. Preserve raw matrices so both levels are reproducible.

Show `baseline` and `final` results side by side, their mean difference, selected stage/hash and coverage. An incomplete matrix is preliminary and shows missing cells; do not turn different subsets into a complete comparison. H1 training results do not replace the held-out baseline. Pass@K or all-repetitions success may be supplementary when requested; neither is the mean score.

## Costs, tokens and time

Report training, no-Skill testing and selected-bank testing separately, plus experiment totals and failure/retry overhead. Report Organizer cost separately when available. Sum distinct model calls; parent totals that already include children must not be added to the same child totals again. Unknown cost is unavailable, not zero.

Preserve native cost and token fields with their semantics. Separate uncached input, cached input and output; total input is cached plus uncached input, and total tokens are total input plus output. Harbor input counts may already include cache reads, so do not add them again. Include reasoning tokens only according to the provider's output-token accounting. Explain any normalized pricing separately from recorded provider cost.

Keep one training resource record for the whole Curator run that produces the bank, including all Actor attempts, bootstrap, evolution, selection and delegated calls. Keep one Test resource record for every case, repetition and frozen variant. Each record has measured USD, start/end timestamps, elapsed milliseconds, token categories and native trial/session references.

| Token metric | Penguin usage |
| --- | --- |
| `cached_input` | `cache_read` in token records or `cacheRead` in cost summaries. |
| `uncached_input` | `cache_write` or `cacheWrite`, the input on cache misses. |
| `output` | `output`, already including thinking and response tokens. |
| `total_input` | Cached input + uncached input. |
| `total` | Total input + output. |

For Harbor, read `cost_usd`, `n_input_tokens`, `n_output_tokens` and `n_cache_tokens` from `agent_result` when present. Total input already includes cached input; derive uncached input only when both values are available. Preserve Penguin's per-session usage artifact when available. Count request usage once across resumed Sessions and parent/child summaries; do not add cumulative counters at every revision. Missing values remain `null`, and incomplete totals are marked partial.

Use native start/end timestamps for wall-clock duration; separate Agent execution time when available. Summed trial durations measure consumed trial time, not elapsed experiment time under parallelism. Report actual completed phases, outstanding work and failed attempts rather than estimating completion from a process being absent.

## Evaluation Center

Resolve the Project App Data Dir from the Environment:

```text
STATE      = <app_data_dir>/agents/<agent_id>/agent_state
BENCHMARK  = <app_data_dir>/benchmarks/<benchmark_id>
SCOREBOARD = BENCHMARK/scoreboard.yaml
```

Append one evaluation per complete State/case/repetition matrix using the existing schema. Preserve existing entries; serialize writes when workers finish concurrently. Use the published Case ids, actual runtime and frozen State version. Do not label a case subset as a whole-Benchmark evaluation.

```yaml
evaluations:
  - time: <UTC ISO timestamp>
    agent_id: <solver id>
    version: <frozen State version>
    provider: <actual provider>
    model_id: <actual model>
    thinking_level: <actual thinking>
    summary_title: <experiment version and condition>
    summary: <coverage and native result references>
    score: <mean case score, 2 decimals>
    cost: <mean of known case costs, 6 decimals, or null>
    duration_ms: <mean case duration, integer>
    cases:
      - case: <published case id>
        score: <mean run score, 2 decimals>
        cost: <mean of known run costs, 6 decimals, or null>
        duration_ms: <mean run duration, integer>
        runs:
          - score: <normalized native score>
            cost: <native run cost or null>
            duration_ms: <native duration in milliseconds>
            session_id: "harbor:<native trial directory>"
```

These scoreboard cost/duration fields are averages; keep experiment totals, SD calculations, tokens, selection evidence and detailed resource accounting in the report. A continuous Train Case has one native run; internal Actor batches remain in training records, not fabricated scoreboard repetitions.
