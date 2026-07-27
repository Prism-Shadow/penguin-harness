---
name: agent-evaluation
description: Internal leaf worker that runs one specified Test Agent on one specified Benchmark Case exactly once, privately scores that execution, and returns one protocol result. Use only when benchmark-design or agent-optimization supplies the complete request; do not use for user-facing evaluation, Benchmark design, or Agent changes.
short_description: Run and score one isolated Benchmark Case.
short_description_zh: 隔离执行并评分一个 Benchmark Case。
version: 5
updated: 2026-07-27T05:39:01Z
---

# Agent Evaluation

Run one specified Test Agent on one specified Benchmark Case exactly once, privately score that execution, and return one protocol result.

The caller owns all Case/Run loops, concurrency, and retries. This worker handles no other Case or Run, launches no evaluator or subagent, modifies no Agent or Benchmark, and never writes `scoreboard.yaml`.

## Contract

Require exactly one value for every field:

```text
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <tested_agent_state_version>
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
provider: <provider>
model_id: <model_id>
```

The `run` value identifies this execution; it does not tell this worker to repeat the Case. If any field is missing, duplicated, or conflicting, return `invalid_request` without creating a Workspace or launching the Test Agent. Do not ask for clarification.

One request has one of two outcomes. A **scored result** means the Test Agent ran and the Rubric was applied; a missing, malformed, or wrong answer still receives zero or partial credit. An **evaluation failure** means the request, launch, provenance check, version check, Benchmark files, or scoring process failed; return a failure code and no score.

## Prepare an isolated run

Under the Environment App Data Dir, resolve `TEST_AGENT_DIR` as `agents/<test_agent_id>` and `BENCHMARK_DIR` as `<test_agent_dir>/benchmarks/<benchmark_id>`. The Evaluator may inspect only the requested Test Agent's canonical State and version; the requested Benchmark config, Case Statement, and private Rubric; and the isolated Test Workspace and Test Trace bound to this execution.

Do not inspect another Agent, Project secrets, hidden configuration, or unrelated Workspaces or Traces. Reject traversal, symlink escape, or any resolved path outside the requested Test Agent.

Require `agent_state/system_config.yaml`, `benchmark_config.toml`, and both `<case_id>/statement/README.md` and `<case_id>/rubric/README.md`. Validate that `runs` is a positive integer, `run` is within `1..runs`, `provider` and `model_id` are non-empty, and the top-level State `version`—default 1—equals `expected_version`.

Before launch, snapshot every file under the Case's `statement/` and `rubric/` directories. Require a Rubric with unambiguous scoring items and a finite Case maximum.

Create a unique collision-checked Workspace under `<test_agent_dir>/workspaces/` and copy only the contents of `statement/` into it. The Test Agent may see the Statement and its own State, but never the Rubric, Gold answers, scoring rules, or Evaluator reasoning.

## Run and verify

Use an existing verified Penguin CLI or repository-local launcher. Do not install or probe a launcher. Record the existing Trace files, then run exactly once in the foreground with a fresh top-level Session:

```bash
PENGUIN_HOME="<parent_of_app_data_dir>" penguin run \
  --message "Read README.md in the current Workspace and complete the task exactly as specified there." \
  --provider "<provider>" --model-id "<model_id>" --project-id "<app_data_dir_basename>" \
  --agent-id "<test_agent_id>" --workspace "<unique_workspace>" --approve allow-all
```

Use the exact requested Agent, provider, model, and Workspace. Do not fall back or relaunch. A missing launcher, nonzero exit, interruption, or misrouted launch is `cli_failed`, not score zero.

Verify after the run that the State version and both directory snapshots are unchanged. Return `version_changed`, `invalid_statement`, or `invalid_rubric` on a mismatch.

Inspect only new or changed Trace files. Bind exactly one root Test Trace whose `session_meta` matches the Workspace, Test Agent State path, provider, and model id. Exclude directly referenced child Session ids. No match, multiple matches, malformed metadata, or an identity mismatch is `provenance_mismatch`; do not search unrelated Sessions to repair it.

## Score

Inspect only the isolated Workspace, the bound Test Trace, and the private Rubric. Apply every scoring item and allowed equivalent. Keep Rubric contents, Gold answers, per-item scoring, and scoring rationale private.

Test Agent output errors are scored behavior and return `status: ok`. Return `invalid_rubric` when the Rubric cannot be applied unambiguously and `invalid_score` when the result is non-finite or outside `0..case_max`.

Set `duration_ms` from the root Test Session. Compute cost from reliable final cumulative usage in that Session and any directly referenced child Traces found in the same bounded pass; otherwise return `cost: null`. Missing cost data must not invalidate a score.

## Return

Emit exactly one plain YAML document with no narration or code fence.

For a scored result:

```text
protocol_version: 1
status: ok
case_id: <case_id>
run: <run>
expected_version: <version>
provider: <provider>
model_id: <model_id>
score: <0_to_case_max>
cost: <number_or_null>
duration_ms: <non_negative_integer>
session_id: <test_session_id>
```

For an evaluation failure, use `null` for an identity field that was missing or conflicting:

```text
protocol_version: 1
status: failed
case_id: <case_id_or_null>
run: <run_or_null>
expected_version: <version_or_null>
provider: <provider_or_null>
model_id: <model_id_or_null>
failure_code: <stable_failure_code>
```

Stable failure codes are `invalid_request`, `invalid_statement`, `invalid_rubric`, `cli_failed`, `provenance_mismatch`, `version_changed`, and `invalid_score`. Never include score, cost, duration, Session id, private data, or optimization advice on failure.
