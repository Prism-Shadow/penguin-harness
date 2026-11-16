# Evaluation and reporting

Train once per independent benchmark/training unit, then evaluate the same frozen `baseline` and `final` States on the complete selected test set three times by default. Honor an explicit repetition count. Each case and repetition starts with a fresh environment and conversation. Test feedback never changes the learned artifact or its selection.

OpenSkill measures both States only after every construction Case has frozen. Other methods retain their own learning order. The required Test comparison is baseline versus final.

## Run and collect

Resolve the Project from the Environment's App Data Dir:

```text
TARGET    = <app_data_dir>/agents/<test_agent_id>
STATE     = TARGET/agent_state
BENCHMARK = <app_data_dir>/benchmarks/<benchmark_id>
CASE      = BENCHMARK/<case_id>
```

Read the selected package's manifest and Case instructions. Keep the provider/model pair, configured thinking level and frozen State version explicit on every launch. A worker owns one case in one test repetition; the controller owns scheduling, aggregation and the scoreboard.

Use Penguin's native delegation and background tools. Give each worker the Benchmark, Case, repetition index, Target identity, expected State version, frozen State/archive, runtime and output path. Respect the Benchmark's concurrency limits and the user's total container limit, including sidecars. Keep job handles and artifact paths until completion.

- **Harbor Cases:** follow the Case's launch and linked run instructions at its declared full task commit. Pass the specified State with the adapter's `agent_state_tar`, host Project identity and model connection. Use the same executable installation for all variants. When supplied, pass the source-built `install_bundle`. Store trials under the Benchmark's `.jobs/` directory with unique job names. The official verifier supplies the score; use the documented metric and scale.
- **Workspace Cases:** give the test Agent only the public statement in a fresh workspace and start a new `penguin run` Session with the explicit Project, Agent and model. Keep the rubric private to the evaluator. Score the resulting work using that rubric and its bound execution trace.

The test Agent receives its solving State and public task, not the rubric, reference answers or learning records. Credentials remain in the runner's private configuration transport. If worker and Target share the same mutable State location, finish one variant before restoring the other; separate frozen copies may run concurrently.

For a Harbor result, read `verifier_result.rewards` and actual runtime/usage from `agent_result`; convert a normalized `0..1` reward to `0..100` when the Benchmark declares that scale. A missing verifier result is not a measured zero. Preserve the native execution status, including a timeout even when it has a score. Keep failures separately and apply only the Benchmark's permitted infrastructure retries. A low-scoring completed answer is not a reason to rerun it.

For the Evaluation Center's standard worker protocol, return one plain YAML result containing:

```yaml
protocol_version: 1
status: ok
case_id: <published case id>
run: <one-based repetition>
agent_id: <Target id>
expected_version: <measured State version>
provider: <actual provider>
model_id: <actual model>
thinking_level: <configured level>
score: <0..100>
cost: <recorded USD or null>
duration_ms: <agent execution duration, integer milliseconds>
session_id: <Session id, or harbor:trial-name>
```

A failed evaluation returns the same request identities, `status: failed` and a `failure_code` of `invalid_request`, `version_changed`, `benchmark_invalid` or `evaluation_failed`, without an invented score. Repair formatting from the existing result rather than launching another attempt. Confirm that results belong to the requested cases, frozen States and runtime, and collect all requested cells before reporting a complete comparison.

## Common report fields

Use the following names across methods. Native method labels remain in the learning artifacts; they do not replace the common report fields.

| Fields | Meaning |
| --- | --- |
| `method` | The method identifier: `skilladam`, `skillopt`, `openskill` or `trace`. |
| `experiment_version`, `component_versions` | Fixed report identity and actual Harness, runner, Benchmark, model and toolkit versions. Prefer user-specified versions; record task repository and commit. |
| `benchmark_id`, `training_unit_id` | Evaluation package and the independent unit that learned its artifact. Record the paired Train package separately. |
| `phase`, `variant` | Resource phase: `train`, `test` or `controller`; measured State: `baseline` or `final`. |
| `state_version`, `state_sha256` | Frozen State identity, separate from experiment version. |
| `case_id`, `run`, `runs`, `score` | Every case's measured score and complete-test repetition index/count. Preserve the metric, scale and aggregation rule. |
| `repetition_scores`, `mean`, `std` | Complete-test repetition scores and their mean/sample standard deviation. |
| `final_minus_baseline` | Difference of unrounded final and baseline Test means. |
| `cost_usd` | Recorded cost for this training unit or test-case repetition. |
| `started_at`, `finished_at`, `duration_ms` | UTC timestamps and elapsed time for that same record. |
| `tokens` | `cached_input`, `uncached_input`, `output`, `total_input`, `total`. |
| `step`, `native_stage` | Numbered training observation and its original method label, independent of Test `run`. |
| `curve_kind` | `benchmark_score`, `virtual_validation` or `none`, as the method specifies. |

`baseline` is the State saved before learning, even when measured after learning. Record its starting Skills and fixed reader; do not call it no-Skill when it contains user-supplied learned content. `final` is the method's exported result, including a training-selected checkpoint where applicable. Record the selection rule and artifact identity.

Display training progress as Step 0, Step 1 and so on. Keep labels such as S0, H1 or B0 in `native_stage`. Retain actual measurements, rejected candidates and regressions; do not replace them with a cumulative maximum. Separate a final verifier grade from online training scores. One training run has no across-training-run standard deviation, and a method without iterative measurements needs no curve.

## Mean and standard deviation

For a mean-score Benchmark with N cases and R complete test repetitions:

```text
repetition_scores[r] = mean_q(score[r, q])
mean = mean_r(repetition_scores[r])
std = sqrt(sum_r((repetition_scores[r] - mean)^2) / (R - 1))
```

For a single case, use its R scores directly. For an overall score across Benchmarks on a common scale, first average the same selected Benchmarks within each repetition, then compute mean and sample standard deviation across those R overall scores. Apply a Benchmark's own within-repetition aggregation when it differs from a case mean.

Report `mean ± std`, preserving full precision until display. With only one repetition, use `std: null`. Do not average per-case or per-Benchmark standard deviations, pool all questions as independent repetitions, select the best run or call this pass@k. Keep Train, virtual validation and Test as separate measurements.

## Cost, time and tokens

Retain one resource record for producing each learned artifact, including initialization, revisions and delegated learning work, and one record for every `benchmark × variant × case × run` test attempt. A library with several Skill files has one construction cost, not one charge per file. Preserve native trial/Session paths with these records.

Use recorded usage. Penguin token records expose cached input as `cache_read`/`cacheRead`, uncached input as `cache_write`/`cacheWrite`, and output as `output`. Harbor commonly supplies `n_input_tokens`, `n_cache_tokens` and `n_output_tokens`: uncached input is total input minus cached input when both exist. Total input is cached plus uncached; total tokens add output. Cached tokens are already included in input, and thinking tokens in output; do not count them twice. Missing categories remain unknown rather than zero.

Use the same elapsed-time boundary across comparisons. Keep task start-to-finish duration, including setup and grading, and agent-only execution duration separately when both are available. The native scoreboard uses agent execution duration. Summed task durations and actual experiment elapsed time are different measurements when tasks overlap.

Keep separate Train, Test and controller totals, including failed-attempt consumption once. Avoid double-counting parent/child summaries of the same requests. Preserve raw totals; when showing Test usage per complete repetition, divide its cost, summed duration and token totals by R. Training is performed once and is not divided by R. Keep baseline/final usage distinct. Mark unavailable values `null` and incomplete totals as partial.

## Evaluation Center

For published Penguin Benchmarks, append one complete matrix per frozen State to `BENCHMARK/scoreboard.yaml`, preserving previous evaluations. Use the existing format, with no new fields. Store scores to two decimals, retain Run costs at their recorded precision and round Case/Evaluation cost averages to six decimals. Store every `duration_ms` as a non-negative integer, rounding Case and Evaluation duration averages. Keep unrounded measurements separately for report statistics:

```yaml
evaluations:
  - time: <UTC timestamp>
    agent_id: <Target id>
    version: <measured State version>
    provider: <provider>
    model_id: <model>
    thinking_level: <level>
    summary_title: <method and baseline/final>
    summary: <public outcome>
    score: <mean of Case scores>
    cost: <mean of known Case costs, or null>
    duration_ms: <mean of Case execution durations>
    cases:
      - case: <published case id>
        score: <mean of Run scores>
        cost: <mean of known Run costs, or null>
        duration_ms: <mean of Run execution durations>
        runs:
          - score: <score>
            cost: <recorded USD or null>
            duration_ms: <execution duration>
            session_id: <native Session/trial id>
```

The scoreboard uses the normalized `0..100` scale and its native average fields, not experiment resource totals or repetition-level `std`. Keep detailed statistics, tokens, versions and learning history in the separate experiment report. A combined Train Case has one native trial; its inner questions and revisions do not become invented Harbor trial entries.

Publish only complete measured matrices. Keep partial results visible in the experiment index. Deliver a concise summary and structured per-case records with links to frozen artifacts, traces and any incomplete work or method deviations.
