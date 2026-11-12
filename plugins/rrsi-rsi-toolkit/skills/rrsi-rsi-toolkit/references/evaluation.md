# Evaluate one cell

How RRSI measures a Target Agent: the controller dispatches workers through `run_subagent`, records full-precision scores and policy-token usage in its experiment directory, and writes complete evaluations to the Benchmark's `scoreboard.yaml`. Each worker receives the measured version's State and source/build record. This reference extends the common evaluation protocol for RRSI's token-cost rule and source candidates.

## Paths

Resolve every path from the Environment's `App Data Dir`; never search for the Project:

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
PENGUIN_HOME = dirname of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = PROJECT_DIR/benchmarks/<benchmark_id>
CASE         = BENCHMARK/<case_id>       # statement/README.md is public; rubric/README.md is private
SCOREBOARD   = BENCHMARK/scoreboard.yaml
OUT          = <experiment directory supplied by the controller>
```

Use the declared Target, Benchmark, experiment and candidate-runtime paths. Keep credentials out of candidate copies, snapshots, results and logs. Source-mode runtime setup uses the configured model connection through the harness's supported configuration flow; the Proposer and Critic never receive credentials.

## The controller

1. Require `benchmark_config.toml` and read its `status`: a literal `draft` is not frozen and a literal `failed` one never calibrated (stop and say so); a missing or any other value is published. Read the Agent State `version` from `STATE/system_config.yaml` (1 when absent) and `model.thinking_level` (`medium` when absent).
2. Fix the runtime once per experiment: `provider` and `model_id` are the pair the user named, else the `Provider` and `Model ID` lines of your own Environment. Never read a pair from the Target's files, a Project default or the server. A half pair stops the run.
3. Set `runs = k` for calibration and candidate measurements, or `runs = test_repetitions` for the requested baseline/final report measurements. Read the Benchmark's execution instructions first: preserve a specified shared Session/container rather than launching a grouped training task once per Case. For independent cases, call `run_subagent` once per Case and run index `1..runs` (omit `agent_id`: the worker is this Agent, so it can read this file) with:

```text
Read <absolute path of this references/evaluation.md> and follow its "The worker" section. Evaluate one cell and reply with the protocol YAML only.
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <agent_state_version>
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
provider: <provider>
model_id: <model_id>
thinking_level: <fixed_target_thinking_level>
harness_record: <absolute OUT/versions/vN.json path>
```

Independent cases of one frozen version may run in parallel within capacity; two versions of the same Target never run at the same time. Follow a Harbor launch when the Benchmark's instructions name Harbor; do not depend on a particular Markdown heading. Run independent cells in the background, at most four at a time unless the user named another limit (never above eight), and retry once at lower concurrency when Docker cannot allocate a network.

For a grouped execution, replace `case_id` in the request with `case_ids: [<the group's Case IDs>]` and dispatch one worker per group/run. The worker follows the Benchmark's continuous execution instructions and returns `case_scores` instead of the single `case_id`, `score` and `score_weight` fields:

```yaml
case_scores:
  - case_id: <case_id>
    score: <0_to_100, full precision>
    score_weight: <Benchmark aggregation weight>
```

The other return fields describe that one execution, including its `session_id`, cost, duration and tokens. Require `case_scores` to cover exactly the requested Case IDs, without duplicates. Expand its scores into the matrix using the Benchmark's mapping, but count usage once per execution. Record this change of RRSI's evaluation unit as an adaptation; do not invent per-question usage from the shared total.

4. Before reading any field, check that the worker-authored text is exactly one plain YAML document. If not, ask the same worker to resend the YAML from its existing result; never rerun the Target for a formatting repair. Require every scored result's `agent_id`, `provider`, `model_id`, `thinking_level` and `harness_record` to match the request, else the matrix is invalid. Save raw cells, scoring weights and token usage under OUT. Derive the score and token aggregates there before rounding for display.
5. `invalid_request`: correct and resend. `version_changed`, `benchmark_invalid` or a runtime mismatch: stop. For `evaluation_failed`, diagnose the missing trial and apply the missing-trial and retry rule in `references/training.md`. Preserve completed results, distinguish an unfinished execution from one that never started, and never rerun a Target merely to repair its result's formatting.
6. Append one evaluation per complete matrix to `SCOREBOARD` (create the file with `evaluations: []` if the Benchmark has none), then re-parse the file and verify the appended record. Its Case rows require individual costs/durations; a grouped execution without that breakdown stays in OUT and the final report rather than inventing per-question measurements:

```yaml
- time: <ISO-8601 UTC, from `date -u +"%Y-%m-%dT%H:%M:%SZ"`>
  agent_id: <test_agent_id>
  version: <agent_state_version measured>
  provider: <provider>
  model_id: <model_id>
  thinking_level: <thinking_level>
  summary_title: >-
    <public title: the method, the step or candidate, and the result>
  summary: >-
    <public summary; never the rubric, gold answers or private scoring>
  score: <Benchmark's aggregate score on 0..100, two decimals>
  cost: <average of known Case costs (six decimals), or null when every Case cost is null>
  duration_ms: <average of the Case durations, integer>
  cases:
    - case: <case_id>
      score: <average of the Run scores>
      cost: <average of known Run costs, or null>
      duration_ms: <average of the Run durations>
      runs:
        - score: <Run score>
          cost: <Run cost or null>
          duration_ms: <Run duration>
          session_id: <Test Session id>
```

Every scoreboard score is on `0..100`; write no `max_score`, no `aggregate`, and no field the shape above does not have. RRSI's calculations use the full-precision records in OUT, not rounded display values. Dollar `cost` stays separate from policy-token C. Record only complete measurements with retained State/build artifacts; the token fields, build binding, proposals, partial matrices and failures stay in OUT, not in the scoreboard.

## Policy-token cost

For each successful trial, retain `n_input_tokens` (including cached input), `n_cache_tokens`
(a subset of input, when available) and `n_output_tokens`. A known zero is zero; unavailable
usage is null. Never estimate token counts from dollars or count cached input twice.

On Harbor, read these fields from `result.json`'s `agent_result`. Follow the authors' coding
adapter: for a trial without `exception_info`, `policy_tokens = (n_input_tokens or 0) +
(n_output_tokens or 0)`, with a zero total recorded as unknown. An exceptional trial has unknown
policy tokens. On local runs, normalize the bound Target Trace's recorded usage to those same
input/output fields, including its task-executing child Sessions exactly once. Keep Analyst,
Proposer and Critic usage separate from target-policy usage.

Across trials, C is the mean of known positive policy-token totals, or null if there are none.
Retain which counts were unavailable. If C is unavailable for either candidate or incumbent,
`Delta C = 0` and Algorithm 2 still applies its cost rule. `cost` continues to mean dollars.

## The worker

You evaluate one requested execution unit. Do not spawn another evaluation worker, write SCOREBOARD or modify the frozen candidate or Benchmark. Run the target's recorded build and State. Return the protocol YAML without narration, headings, fences or private scoring details.

1. Validate the request and read `harness_record`; its frozen State version must equal `expected_version`. Require `STATE/system_config.yaml`, `benchmark_config.toml`, and each requested Case's `statement/README.md` and `rubric/README.md`; `status = "failed"` is `benchmark_invalid`. Snapshot the model settings and statement/rubric files. Use the Benchmark's score normalization and aggregation weights; store each trial's normalized score on 0..100 and its weight (1 for equally weighted trials).
2. **Workspace cases.** Create a unique Workspace under `TARGET/workspaces/`, resolve it to an absolute canonical path under that directory, and copy only `statement/` into it. The Target may see the statement and its own State, never the rubric. Grouped cases follow the Benchmark's shared-workspace and execution instructions. For an independent case, run one foreground execution as separate shell statements in this order:

```bash
PROJECT_DIR="<app_data_dir>"
PROJECT_ID="$(basename "$PROJECT_DIR")"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")"
export PENGUIN_HOME
penguin run \
  --message "Read README.md in the current Workspace and complete the task exactly as specified there." \
  --provider "<provider>" --model-id "<model_id>" --project-id "$PROJECT_ID" \
  --thinking "<thinking_level>" \
  --agent-id "<test_agent_id>" --workspace "<absolute_unique_workspace_path>" \
  --approve allow-all
```

   This command is the State-only launch. In source mode, replace the PATH-resolved `penguin` with the recorded absolute candidate entry (for example, `node <candidate>/packages/cli/dist/penguin.js`), and set PENGUIN_HOME to a fresh target data root prepared as `initialization.md` describes. Load the version's frozen State there, use the configured model connection, and bind the resulting Trace to that runtime State path. Before invoking the candidate CLI, run `unset PENGUIN_API_URL PENGUIN_API_TOKEN PENGUIN_SESSION_ID` in that shell; otherwise inherited connection settings override PENGUIN_HOME and route the call back to the controller's server. Never fall back to a stock CLI when the candidate entry fails.

   Never pass `--source`: it is retired. Use the requested Agent, Project, Workspace and model pair. Return `evaluation_failed` for a launch or execution failure, retaining its evidence. The controller applies the retry rule in `references/training.md`; confirm the previous process has ended before resuming a missing trial, and never rerun a completed result or an execution whose state is still unclear.
3. **Harbor cases.** Run the Benchmark's documented launch from a checkout of its specified 40-character commit, following its repository instructions for task layout, grouping, environment, scoring and credentials. Pack the frozen State without credentials, runtime memory or schedules, with the State contents at the archive root; do not pass a snapshot with an enclosing `agent_state/` directory. Pass it as `--ak agent_state_tar=<archive>` and pass the fixed thinking level through `--ak thinking=<thinking_level>`. Use the controller's configured host Project for model connection setup. For a source candidate, also pass its recorded `--ak install_bundle=<candidate bundle>` (or the adapter's equivalent custom-build option); match the bundle's package/Node versions and never substitute a release bundle. A State-only run may use the fixed release bundle. Give every job a unique name and retain its installation metadata and trial directory. Convert the verifier reward using the Benchmark's normalization; read dollar cost from `agent_result.cost_usd`, tokens as above, duration from `agent_execution`, and use `harbor:<trial directory name>` as session id.
4. After the run, verify that the frozen State/build, model settings and Benchmark materials are unchanged (`version_changed` / `benchmark_invalid` otherwise). Verify the actual entry or installation record against `harness_record`. Bind one root Trace whose Workspace, runtime State path, provider and model match the request (`evaluation_failed` if no unique match), or the Harbor trial and its `agent_result.model_usage`. A trial the Benchmark declares unscorable is `evaluation_failed`.
5. For workspace cases, score against the private Rubric from the Workspace and bound Target Traces. For Harbor, use the verifier result without a second worker-authored grade. A wrong, missing or malformed answer is scored behavior (`status: ok`); a launcher, binding or scoring failure is not. Use recorded duration, dollar cost and token usage, with missing usage null. Preserve full precision for RRSI's calculations.
6. Return the YAML as the only worker-authored text, without fences. Scored:

```text
protocol_version: 1
status: ok
case_id: <case_id>
run: <run>
agent_id: <test_agent_id>
expected_version: <version>
harness_record: <requested version record path>
provider: <actual_provider>
model_id: <actual_model_id>
thinking_level: <configured_thinking_level>
score: <0_to_100, full precision>
score_weight: <Benchmark aggregation weight, 1 when equally weighted>
cost: <number_or_null>
n_input_tokens: <non_negative_integer_or_null>
n_cache_tokens: <non_negative_integer_or_null>
n_output_tokens: <non_negative_integer_or_null>
policy_tokens: <positive_total_or_null>
duration_ms: <non_negative_integer>
session_id: <test_session_id>
```

   Failed (`null` for an identity field that was missing or conflicting; use `case_ids` instead of `case_id` for a group; never a score, cost, duration, session id, private data or advice):

```text
protocol_version: 1
status: failed
case_id: <case_id_or_null>
run: <run_or_null>
agent_id: <test_agent_id_or_null>
expected_version: <version_or_null>
provider: <provider_or_null>
model_id: <model_id_or_null>
thinking_level: <thinking_level_or_null>
failure_code: <invalid_request | benchmark_invalid | version_changed | evaluation_failed>
```

If the controller reports invalid formatting, resend only the clean YAML from the result already in this Session; do not call tools, relaunch or rescore.
