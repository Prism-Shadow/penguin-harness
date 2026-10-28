# Scores, versions and resource records

Keep a readable report and the structured output of `evaluation_results.py`. The required
records are:

| Record | OpenSkill content |
| --- | --- |
| Test comparison | Pre-training base and frozen final State, each repetition's complete-test score, `mean`, `std`, and final-minus-baseline gain |
| Accuracy | The same statistics when the Benchmark defines the metric as accuracy; otherwise keep its native score name |
| Training | Virtual-test measurements by attempt/revision, coverage, feedback action, revision hashes, final tested status and stopping reason |
| Versions | Fixed experiment version, report schema, Harness/runner/benchmark/model/toolkit versions, source pins, frozen Skill versions and State digests |
| Cost | Recorded USD per construction unit and per test Case/repetition/State, plus failed attempts and separate Train/Test/controller totals |
| Time | Start, finish and elapsed time at those same levels; agent-only duration when available; summed durations separately from actual campaign wall time |
| Tokens | Cached input, uncached input, output, total input and total tokens at the same levels, with separate Train/Test/controller totals |

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

## Fix the record before launch

Add these fields to the executor configuration; replace the examples with actual values:

```json
{
  "experiment_version": "<fixed campaign version>",
  "component_versions": {
    "harness": "<actual version/commit>",
    "runner": "<actual Harbor or other runner version>",
    "toolkit": "<installed package version>",
    "skill": "<installed OpenSkill version>",
    "skill_sha256": "<installed Skill digest>",
    "model_revision": null
  },
  "reporting_metric": {
    "name": "benchmark_score",
    "definition": "<public Benchmark definition of its 0..100 score>"
  }
}
```

Use the user's experiment/component versions when supplied and actually available; otherwise
resolve compatible installed versions and record them. Do not relabel an installed component
with a requested version it does not implement. A provider alias alone does not establish a
concrete model revision: keep that revision null when unavailable, with the actual provider,
model id and thinking level already fixed in `runtime`. The binding supplies Benchmark package
versions, manifest hashes and task-source commit. The report includes measured State versions
and hashes, the library digest and each exported Skill's frontmatter version and digest.

For several units, use one campaign version in their configs. Initialization generates one
stable experiment version if omitted; resuming does not regenerate it. The current structured
report schema is `openskill-results/v1`. Existing experiments are not rewritten to invent
missing provenance.

Set `reporting_metric.name` to `accuracy` only when the Benchmark's public definition supports
that label; provide the definition. Both score and accuracy use `0..100` here, and SD is in
percentage points. A graded reward is not automatically binary task accuracy. Without an
accuracy definition, `accuracy` is null and `mean`/`std` describe the native Benchmark score.
Do not read private rubrics during construction to discover a metric definition.

## Baseline and training curves

The baseline is the State saved **before construction**, not a score that must be measured
before construction. Evaluate that State and the learned State only after the global freeze.
Their results cover the same Test Cases and repetition count. Report both with sample SD
and the final-minus-baseline gain. The helper also retains repetition-wise differences;
pairing repetition indices does not imply shared random seeds or a causal significance test.

OpenSkill's construction has no official Train accuracy or target-score optimization curve.
Set `curve_kind: virtual_validation`.
Keep `training.benchmark_score_curve`, `accuracy` and `std` null with the explanation. Do not
enable `/api/judge`, grade saved Train answers or introduce a target score to fill these fields.
`training.units[].virtual_curve` contains actual virtual-test rates (`0..1`), acceptance and
coverage flags, attempts, revision indices and feedback actions. Failed/interrupted verifier
executions have a null rate. Preserve nonmonotonic measurements rather than taking a running
maximum. An untested final revision stays untested. These proxy records must be labeled
virtual validation, never Train accuracy. Keep one training run without across-training-run SD.

## Collect native resource evidence

Normalize one native artifact without launching or scoring anything:

```bash
python3 "<skill_dir>/scripts/resource_usage.py" normalize harbor "<trial/result.json>"
python3 "<skill_dir>/scripts/resource_usage.py" normalize penguin "<native usage-summary.json>"
```

For Harbor, `agent_result.cost_usd` is the monetary measurement. `n_input_tokens` includes
`n_cache_tokens`; `n_output_tokens` already includes thinking and response. Derive uncached
input only when total input and cached input are both present. Trial start/finish timestamps
give elapsed time; preserve `agent_execution` timing separately.

For Penguin, token records use `cache_read`, `cache_write`, `output`; exported cost summaries
use `cacheRead`, `cacheWrite`, `output`. Read tokens from the token fields, not monetary
`costParts`. Cached input + uncached input gives total input; add output once for total tokens.
Read a recorded USD cost when available. A summary marked `hasUncosted` has an unknown complete
cost. Never infer current prices, read credentials or query private configuration to fill it.

The isolated executor already saves role messages and process timestamps. Collect them with:

```bash
python3 "<skill_dir>/scripts/resource_usage.py" collect-construction "<OUT>"
```

Save the output to a new resource-ledger file in OUT. It sums only `token_usage.request` for
each invocation, including interrupted roles; it never sums cumulative `session` counters
again when the creator resumes. It reads no answer, hidden rubric or credential. It records
observed role token counts and process timing, leaving USD unknown. Reconcile recorded native
cost summaries, independent research calls and any other missing usage before declaring
Train coverage complete. This initial collection deliberately marks coverage partial.

## Resource ledger

Maintain `OUT/measurements.json` outside the frozen library. One row owns one disjoint native
invocation or aggregate of requests. A row's identity, source paths and usage ids make it
auditable. For example, a Test record after normalization is:

```json
{
  "schema_version": 1,
  "coverage": { "train": "partial", "test": "partial", "controller": "unknown" },
  "experiment_time": { "started_at": null, "finished_at": null },
  "records": [
    {
      "record_id": "test-baseline-case1-r1",
      "phase": "test",
      "case_id": "<published Case id>",
      "variant": "baseline",
      "run": 1,
      "session_id": "<exact scored trial/session id>",
      "status": "completed",
      "usage_ids": ["<native request ids or one disjoint aggregate coverage id>"],
      "artifact_paths": ["<native result or usage artifact>"],
      "format": "canonical",
      "usage": {
        "cost_usd": null,
        "started_at": null,
        "finished_at": null,
        "duration_ms": null,
        "agent_duration_ms": null,
        "tokens": { "cached_input": null, "uncached_input": null, "output": null,
                    "total_input": null, "total": null }
      }
    }
  ]
}
```

For a training row, use `phase: train` and its construction Case id; omit variant/run.
Use `phase: controller` for coordination overhead not already included in training/test
invocations. For convenience, `format: harbor` or `penguin` accepts the native JSON object
in `usage`; the normalizer selects only the required fields. Keep the original artifact.
The controller reads detailed usage alongside each worker's unchanged protocol YAML; never
add token fields to that YAML or the native scoreboard schema.

List every underlying request in `usage_ids` when an aggregate includes child calls. Choose
either the disjoint request rows or their aggregate, never both. Repeated ids are rejected.
Different record labels do not make overlapping usage independent. If only a creator Session
total exists, replace its covered operation rows with one aggregate; do not assign that full
Session total to each revision. A field measured later updates its existing record rather
than appending another charge. Preserve previous ledger versions for audit.

Keep failed/not-started/interrupted attempts with their own ids and measured consumption.
Their usage belongs in totals even though they have no score cell. A successful Test row must
match its exact Case, repetition, variant and session; do not attach another trial's usage.
Missing resource rows fall back to recorded cell cost/duration, with tokens and timestamps
unknown and coverage partial. Do not invent zero-cost or zero-token measurements.

`coverage` is `complete` only after reconciling every requested invocation, including failures;
otherwise use `partial` or `unknown`. Totals include `known_total`, `unknown_records`, coverage,
and a full `total` that is null when incomplete. A missing cost does not discard known tokens.
Per-unit training resources are shared by all skills produced in that unit: link the listed
skill ids to the shared cost record, rather than splitting it arbitrarily or counting it once
per skill. Truly isolated per-skill measurements may be recorded separately with evidence.

## Produce and publish the report

```bash
python3 "<skill_dir>/scripts/evaluation_results.py" report "<OUT>" "evaluation-matrices.json" \
  --measurements "measurements.json" --time "<UTC timestamp>" --summary "<public summary>"
```

This joins resources to `matrices[].cases[].trials`, adds construction-unit summaries and
virtual curves, and emits separate Train/Test/controller and experiment totals. It hashes
the supplied ledger for provenance. Retain each regenerated report and its ledger hash.
The `scoreboard_record` stays in the host's existing shape; detailed versions/tokens belong
in the report. Publish as `experiment-organization.md` specifies.

For the common comparison, use the helper's `comparison.baseline` and `comparison.final`,
and take `comparison.final_minus_baseline.mean` as the scalar `final_minus_baseline`.
Keep its paired-difference statistics in the method's detailed report. `std` and
`sample_std` name the same quantity there; use `std` in shared tables.

For a campaign, add `"measurements": "measurements.json"` to each entry of its experiment
manifest. The aggregate command checks disjoint usage across units and emits resource totals
alongside the overall scores. Attribute shared controller calls once, not once per Benchmark.
Add campaign `experiment_time.started_at` and `finished_at` from actual lifecycle timestamps.
Summed durations may exceed elapsed wall time under concurrency; the recorded campaign time
is authoritative. Keep source records, failure coverage and all measured versions in the
final report even when some cost or token fields remain unknown.
