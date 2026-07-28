---
name: agent-evaluation
description: Internal leaf worker that runs one specified Test Agent on one specified Benchmark Case exactly once, privately scores that execution, and returns one protocol result. Use only when benchmark-design or agent-optimization supplies the complete request; do not use for user-facing evaluation, Benchmark design, or Agent changes.
short_description: Run and score one isolated Benchmark Case.
short_description_zh: 隔离执行并评分一个 Benchmark Case。
version: 9
updated: 2026-07-28T13:10:00Z
---

# Agent Evaluation

Handle one evaluation request from a `run_subagent` caller: run the specified Test Agent on one Benchmark Case once, score that execution privately, and return one protocol result.

The top-level Benchmark Designer or Optimizer owns all Case and Run loops, concurrency, and follow-up handling. This worker handles no other Case or Run, launches no evaluator or subagent, modifies no Agent or Benchmark, and never writes `scoreboard.yaml`. Use the Penguin CLI only to launch the specified Test Agent; do not use it to create another phase, designer, optimizer, or evaluator.

Operate silently. Call tools without progress messages. Across all streamed and final responses, the only worker-authored text must be the final plain protocol YAML. Emit no narration, headings, Markdown fences, summaries, private scoring details, or other text.

## Before you start

Use this Skill only for a complete request from a `run_subagent` caller. If the request is incomplete or inconsistent, return `invalid_request` through the protocol instead of asking the user a question.

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

One request represents one Test Agent execution. The `run` value identifies that execution; it is not a repeat count. If any field is missing, duplicated, or conflicting, return `invalid_request` without creating a Workspace or launching the Test Agent.

Return a **scored result** when the Test Agent ran and the Rubric could be applied. Wrong, malformed, or missing Test Agent output is still a scored result. Return an **evaluation failure** when the request, Benchmark, launch, version check, Trace binding, or scoring process prevents a valid score.

## Prepare

Use the `Project Dir` from the Environment:

```text
TEST_AGENT_DIR = <project_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <test_agent_dir>/benchmarks/<benchmark_id>
```

Reject path traversal, symlink escape, or any resolved path outside the requested Test Agent. Inspect only the requested Agent State, Benchmark config and Case, isolated Test Workspace, and Traces needed to verify this execution. Do not inspect another Agent, Project secrets, hidden configuration, or unrelated Workspaces or Traces.

Require `agent_state/system_config.yaml`, `benchmark_config.toml`, `<case_id>/statement/README.md`, and `<case_id>/rubric/README.md`. Check that `runs` is positive, `run` is within `1..runs`, and `provider` and `model_id` are non-empty. The top-level Agent State `version`, defaulting to 1, must equal `expected_version`; otherwise return `version_changed`.

Before launch, snapshot every file under the Case's `statement/` and `rubric/` directories. Require a usable Rubric with a finite Case maximum. Create a unique Workspace under `<test_agent_dir>/workspaces/` and copy only `statement/` into it. The Test Agent may see the Statement and its own State, but never the Rubric, Gold answers, scoring rules, or Evaluator reasoning.

## Run and verify

Use an existing verified Penguin CLI or repository-local launcher. Do not install or probe a launcher. Snapshot the isolated Workspace and record the existing Trace files, then start one foreground execution with a fresh top-level Session:

```bash
PROJECT_DIR="<project_dir>"
PROJECT_ID="$(basename "$PROJECT_DIR")"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")"
export PENGUIN_HOME
penguin run \
  --message "Read README.md in the current Workspace and complete the task exactly as specified there." \
  --provider "<provider>" --model-id "<model_id>" --project-id "$PROJECT_ID" \
  --agent-id "<test_agent_id>" --workspace "<unique_workspace>" --approve allow-all
```

Use the exact requested Agent, provider, model, and Workspace. Never fall back to another value. Retry the launch once only when unchanged Workspace and Trace evidence proves that the Test Agent did not start. If it may have started, do not retry. If the launch still fails, return `evaluation_failed`.

Verify after the run that the State version and both directory snapshots are unchanged. Return `version_changed` when the State version differs and `benchmark_invalid` when the Statement or Rubric differs.

Inspect only new or changed Traces. Bind exactly one root Test Trace whose Workspace, Agent State path, provider, and model match this request. Ignore unrelated parallel Traces and exclude the root Trace's directly referenced child Sessions. Return `evaluation_failed` if there is no unique match.

## Score

Inspect only the isolated Workspace, the bound root Trace, its directly referenced child Traces, and the private Rubric. Apply every scoring item and allowed equivalent. Keep Rubric contents, Gold answers, per-item scoring, and scoring rationale private.

A wrong answer, missing artifact, malformed output, or task failure attributable to the Test Agent is scored behavior and returns `status: ok`. A launcher, Trace-binding, or Evaluator failure is not scored. Return `benchmark_invalid` when the Rubric cannot be applied and `evaluation_failed` when the score is non-finite or outside `0..case_max`.

Set `duration_ms` from the root Test Session. Compute cost from reliable final cumulative usage in that Session and directly referenced child Traces found in the same bounded pass. If the required data is unavailable, return `cost: null`. Missing cost data must not invalidate a score.

## Return

Return the required YAML as the only worker-authored text.

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
