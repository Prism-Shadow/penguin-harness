---
name: agent-evaluation
description: Internal leaf worker that runs one specified Test Agent on one specified Benchmark Case exactly once, privately scores that execution, and returns one protocol result. Use only when benchmark-design or agent-optimization supplies the complete request; do not use for user-facing evaluation, Benchmark design, or Agent changes.
short_description: Run and score one isolated Benchmark Case.
short_description_zh: 隔离执行并评分一个 Benchmark Case。
version: 6
updated: 2026-07-27T09:12:00Z
---

# Agent Evaluation

Run one specified Test Agent on one specified Benchmark Case exactly once, privately score that execution, and return one protocol result.

The caller owns all Case/Run loops, concurrency, and handling after this worker returns. This worker handles no other Case or Run, launches no evaluator or subagent, modifies no Agent or Benchmark, and never writes `scoreboard.yaml`.

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

One request has one of two outcomes. Return a **scored result** when the Test Agent ran and the Rubric was applied. A missing, malformed, or wrong answer still receives zero or partial credit. Return an **evaluation failure** when the request, launch, provenance check, version check, Benchmark files, or scoring process failed. Include a failure code and no score.

## Prepare an isolated run

Use the `Project Dir` from the Environment. Resolve `TEST_AGENT_DIR` as `<project_dir>/agents/<test_agent_id>` and `BENCHMARK_DIR` as `<test_agent_dir>/benchmarks/<benchmark_id>`. Inspect only the requested Test Agent State and version, the requested Benchmark config and Case, the isolated Test Workspace, and the Test Trace for this execution.

Do not inspect another Agent, Project secrets, hidden configuration, or unrelated Workspaces or Traces. Reject traversal, symlink escape, or any resolved path outside the requested Test Agent.

Require `agent_state/system_config.yaml`, `benchmark_config.toml`, `<case_id>/statement/README.md`, and `<case_id>/rubric/README.md`. Check that `runs` is a positive integer and that `run` is within `1..runs`. Require non-empty `provider` and `model_id`. The top-level State `version`, defaulting to 1, must equal `expected_version`.

Before launch, snapshot every file under the Case's `statement/` and `rubric/` directories. Require a Rubric with unambiguous scoring items and a finite Case maximum.

Create a unique collision-checked Workspace under `<test_agent_dir>/workspaces/` and copy only the contents of `statement/` into it. The Test Agent may see the Statement and its own State, but never the Rubric, Gold answers, scoring rules, or Evaluator reasoning.

## Run and verify

Use an existing verified Penguin CLI or repository-local launcher. Do not install or probe a launcher. Snapshot the isolated Workspace and record the existing Trace files, then start one foreground execution with a fresh top-level Session:

```bash
PROJECT_DIR="<project_dir>"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")" penguin run \
  --message "Read README.md in the current Workspace and complete the task exactly as specified there." \
  --provider "<provider>" --model-id "<model_id>" --project-id "$(basename "$PROJECT_DIR")" \
  --agent-id "<test_agent_id>" --workspace "<unique_workspace>" --approve allow-all
```

Use the exact requested Agent, provider, model, and Workspace. Never fall back to another value. You may retry the launch once, but only when you can prove that the Test Agent did not start. There must be no new or changed Test Trace or Workspace file. If you are unsure, do not retry. At most two launch attempts may produce at most one Test Agent execution.

If the launch still fails after any safe retry, return `evaluation_failed`. Never retry when the Test Agent may already have started.

Verify after the run that the State version and both directory snapshots are unchanged. Return `version_changed` when the State version differs and `benchmark_invalid` when the Statement or Rubric differs.

Inspect only new or changed Trace files. Parallel evaluations may create other new Traces; ignore any whose Workspace does not match this request. Bind exactly one root Test Trace whose `session_meta` also matches the Test Agent State path, provider, and model id. Exclude directly referenced child Session ids. Return `evaluation_failed` if there is no unique valid match.

## Score

Inspect only the isolated Workspace, the bound Test Trace, and the private Rubric. Apply every scoring item and allowed equivalent. Keep Rubric contents, Gold answers, per-item scoring, and scoring rationale private.

Test Agent output errors are scored behavior and return `status: ok`. Return `benchmark_invalid` when the Rubric cannot be applied unambiguously and `evaluation_failed` when the result is non-finite or outside `0..case_max`.

Set `duration_ms` from the root Test Session. Compute cost from reliable final cumulative usage in that Session and directly referenced child Traces found in the same bounded pass. If the required data is unavailable, return `cost: null`. Missing cost data must not invalidate a score.

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

Use four failure codes:

- `invalid_request`: the request is incomplete or inconsistent.
- `benchmark_invalid`: the Statement, Rubric, or scoring contract is invalid.
- `version_changed`: the Test Agent version does not match the request or changed during evaluation.
- `evaluation_failed`: launch failed after a safe retry, or Trace binding or scoring failed.

Never include score, cost, duration, Session id, private data, or optimization advice on failure.
