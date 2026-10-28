# Evaluate one cell

How this toolkit measures a Target Agent on a Benchmark without any other plugin: the toolkit's Skill is the controller, every Case × run cell is scored by a worker the controller spawns through `run_subagent`, and every complete evaluation lands in the Benchmark's `scoreboard.yaml` in the shape the Evaluation Center reads. This OpenSkill reference follows the host’s cell/result protocol, with the global freeze and source binding required below.

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
```

Reject traversal, symlink escape, or any path outside TARGET and BENCHMARK. Never read `.project_config.toml`, `.vault.toml`, the server's `api-token` file or `web.db`, and never call the server's HTTP API with a token read from disk.

## The controller

Construct once and measure each frozen State on the whole evaluation set three times by
default; use the count recorded before construction. Follow `experiment-organization.md`
for scheduling and statistics. `run` identifies a complete-test repetition. Every Case and
repetition needs its own fresh environment, conversation and trial id; none retrains the
library. Reuse the same State archive and verify its recorded full digest across repetitions.
Collect each trial's cost, start/finish, elapsed time and token breakdown in the separate
resource ledger from `result-records.md`, bound to the same Case/run/variant/session id.
Keep failed-attempt consumption and controller overhead. The worker protocol and native
scoreboard shape below remain unchanged; the controller collects detailed native artifacts
alongside the protocol result. Both baseline and final receive `mean`, sample `std` and a
reported gain in the experiment report.

Require the executor’s global `freeze.json` and `evaluation_plan` before any measured
cell. Use that plan’s Benchmark and Case ids, which may be the paired held-out package.
A grouped GDPevo Train Case is construction input, not a scored candidate. Fix the source
commit from `benchmark_binding.source_pin` for Baseline and final; never resolve a moving
branch twice. Once frozen, resolve held-out statement links against that same source pin.
If a held-out statement explicitly pins another commit, report the conflict rather than
substituting task files. Follow [harbor.md](harbor.md) §A once before dispatching Harbor cells.
Pass the selected checkout and full source commit as execution context outside the
unchanged protocol fields.


1. Require `benchmark_config.toml` and read its `status`: a literal `draft` is not frozen and a literal `failed` one never calibrated (stop and say so); a missing or any other value is published. Read the Agent State `version` from `STATE/system_config.yaml` (1 when absent) and `model.thinking_level` (`medium` when absent).
2. Fix the runtime once per experiment: `provider` and `model_id` are the pair the user named, else the `Provider` and `Model ID` lines of your own Environment. Never read a pair from the Target's files, a Project default or the server. A half pair stops the run.
3. For every Case in the declared case set and every run index `1..runs`, call `run_subagent` once (omit `agent_id`: the worker is this Agent, so it can read this file) with exactly:

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
```

Cases of one frozen State may run in parallel within capacity; two States of the same Target never run at the same time. A Case whose statement has a `## How this case is run` section naming the Harbor framework is a Harbor case, as every built-in Benchmark's are: run its cells in the background, at most four at a time unless the user named another limit (never above eight), launching the next cell the moment one returns rather than in batches and without polling, and retry once, at lower concurrency, a cell Docker could not give a network (its trial's `result.json` under `BENCHMARK/.jobs/` names an exhausted address pool; that is never a score). Also count sidecars and construction containers against the shared Docker capacity and respect any lower per-host Benchmark limit.

4. Before reading any field, check that the worker-authored text is exactly one plain YAML document. If not, ask the same worker to resend the YAML from its existing result; never rerun the Target for a formatting repair. Require every scored result's `agent_id`, `provider`, `model_id` and `thinking_level` to equal the fixed runtime, else the matrix is invalid: stop.
5. `invalid_request`: correct and resend. `version_changed` or `benchmark_invalid`: stop. `evaluation_failed`: ask the same worker to diagnose and repair, and rerun only that cell when Workspace and Trace evidence proves the Target never started; every retry applies a new, specific repair. A matrix with a missing cell has no score: never average a partial matrix.
6. Collect the planned variants and run `evaluation_results.py report` as specified in
   `experiment-organization.md`. Append its `scoreboard_record` for each complete matrix
   to `SCOREBOARD` (create the file with `evaluations: []` if the Benchmark has none), then
   re-parse and verify the appended record. Do not duplicate a previously published matrix
   when resuming. The record retains this native shape:

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
  score: <average of the Case scores, two decimals>
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

Every score is on the fixed `0..100` scale; write no `max_score`, no `aggregate`, and no field the shape above does not have. The stored averages are authoritative. Record only complete measurements of a State that still exists as a snapshot; a method's own history (proposals, skipped candidates, partial matrices, failures) stays in the method's output directory, not in the scoreboard.

## The worker

You evaluate exactly one cell. Do not spawn another worker, do not write `SCOREBOARD`, do not change the Target or the Benchmark. Operate silently: across streamed and final responses, the only text you author is the final protocol YAML — no narration, headings, fences or scoring details.

1. Validate the request: every field present once and consistent, else return `invalid_request`. Require `STATE/system_config.yaml`, `benchmark_config.toml`, `CASE/statement/README.md` and `CASE/rubric/README.md`; `status = "failed"` is `benchmark_invalid`. The State `version` (1 when absent) must equal `expected_version`, else `version_changed`. Snapshot `model.thinking_level` (`medium` when absent) and every file under `statement/` and `rubric/`. The Rubric's items must total exactly 100 points.
2. **Workspace cases.** Create a unique Workspace under `TARGET/workspaces/`, resolve it to an absolute canonical path under that directory, and copy only `statement/` into it. The Target may see the statement and its own State, never the rubric. Run one foreground execution as separate shell statements in this order:

```bash
PROJECT_DIR="<app_data_dir>"
PROJECT_ID="$(basename "$PROJECT_DIR")"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")"
export PENGUIN_HOME
penguin run \
  --message "Read README.md in the current Workspace and complete the task exactly as specified there." \
  --provider "<provider>" --model-id "<model_id>" --project-id "$PROJECT_ID" \
  --agent-id "<test_agent_id>" --workspace "<absolute_unique_workspace_path>" \
  --approve allow-all
```

   (Never pass `--source`: it is retired; every Session `penguin run` creates is a CLI Session and lands in Settings › Archived chats.) Use the exact requested Agent, Project, Workspace and model pair; never fall back to a Project default. Retry a launch only when unchanged Workspace and Trace evidence proves the Target did not start, each retry with a new diagnosis and a specific correction. Return `evaluation_failed` when no safe repair remains or it is unclear whether the Target started.
3. **Harbor cases.** A statement may name a branch, tag or full commit. Use the checkout
   and commit fixed by the controller for this experiment and follow [harbor.md](harbor.md)
   §B–C in place of the Workspace launch. Require the statement’s exact `-p` and `-i`, the
   requested Target State archive, model and thinking level. Preserve its network, time and
   turn settings; do not replace the selected task with an old repository layout. One cell
   means one trial. Bind the returned result to that trial, not to a prior job. A trial with
   no actual model execution or no verifier reward is an evaluation failure, not zero.
   Never run another training procedure or revise frozen skills inside a Test cell.
4. After the run, verify that the State `version`, `model.thinking_level` and both material snapshots are unchanged (`version_changed` / `benchmark_invalid` otherwise). Bind exactly one root Trace whose Workspace, Agent State path, provider and model match this request (`evaluation_failed` if there is no unique match); read the actual `provider` / `model_id` from its `session_meta`. A Harbor case binds its trial instead: the actual pair is the key of `agent_result.model_usage`, and a trial the README says has no score is `evaluation_failed`.
5. Score against the private Rubric from the Workspace, the bound root Trace and its directly referenced child Traces only. A wrong, missing or malformed answer is scored behavior (`status: ok`); a launcher, binding or scoring failure is not. `duration_ms` is the root Session's; `cost` only from usage or cost already recorded in those Traces, else `null`.
6. Return the YAML as the only worker-authored text, without fences. Scored:

```text
protocol_version: 1
status: ok
case_id: <case_id>
run: <run>
agent_id: <test_agent_id>
expected_version: <version>
provider: <actual_provider>
model_id: <actual_model_id>
thinking_level: <configured_thinking_level>
score: <0_to_100, two decimals>
cost: <number_or_null>
duration_ms: <non_negative_integer>
session_id: <test_session_id>
```

   Failed (`null` for an identity field that was missing or conflicting; never a score, cost, duration, session id, private data or advice):

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
