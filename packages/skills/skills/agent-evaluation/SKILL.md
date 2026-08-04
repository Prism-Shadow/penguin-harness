---
name: agent-evaluation
description: Run one specified Test Agent on one specified Benchmark Case exactly once, privately score that execution, and return one protocol result.
short_description: Run and score one isolated Benchmark Case.
short_description_zh: 隔离执行并评分一个 Benchmark Case。
version: 6
updated: 2026-08-04T00:00:00Z
---

# Agent Evaluation

Handle one evaluation request from a `run_subagent` caller: run the specified Test Agent on one Benchmark Case once, score that execution privately, and return one protocol result.

The top-level Benchmark Designer or Optimizer owns all Case and Run loops, concurrency, and follow-up handling. This worker handles no other Case or Run, launches no evaluator or subagent, modifies no Agent or Benchmark, and never writes `scoreboard.yaml`. Use the Penguin CLI only to launch the specified Test Agent; do not use it to create another phase, designer, optimizer, or evaluator.

Operate silently. Call tools without progress messages. Across all streamed and final responses, the only worker-authored text must be the final plain protocol YAML. Emit no narration, headings, Markdown fences, summaries, private scoring details, or other text.

## Before you start

Use this Skill only for a complete request from a `run_subagent` caller. If the request is incomplete or inconsistent, return `invalid_request` through the protocol instead of asking the user a question.

## Contract

Require exactly one value for every field below:

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

One request represents one Test Agent execution. The `run` value identifies that execution; it is not a repeat count. `provider` and `model_id` must both be non-empty and select that exact configured model. If a required field is missing, duplicated, or conflicting, return `invalid_request` without creating a Workspace or launching the Test Agent.

Return a **scored result** when the Test Agent ran and the Rubric could be applied. Wrong, malformed, or missing Test Agent output is still a scored result. Return an **evaluation failure** when the request, Benchmark, launch, version check, Trace binding, or scoring process prevents a valid score.

Resolve the Project, Test Agent, Benchmark, and Case only from the explicit request and Environment App Data Dir. Reject traversal, symlink escape, or any path outside the requested Test Agent. Never read a Project configuration file, credential, or vault.

## Prepare

Use the `App Data Dir` from the Environment:

```text
TEST_AGENT_DIR = <app_data_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <test_agent_dir>/benchmarks/<benchmark_id>
```

Reject path traversal, symlink escape, or any resolved path outside the requested Test Agent. Inspect only the requested Agent State, Benchmark config and Case, isolated Test Workspace, and Traces needed to verify this execution. Do not inspect another Agent, Project secrets, hidden configuration, or unrelated Workspaces or Traces.

Require `agent_state/system_config.yaml`, `benchmark_config.toml`, `<case_id>/statement/README.md`, and `<case_id>/rubric/README.md`. Treat `run` only as the caller-owned label for this evaluation and return it unchanged; do not read or validate the total Run count. The top-level Agent State `version`, defaulting to 1, must equal `expected_version`; otherwise return `version_changed`. Read and snapshot `model.thinking_level` from this Target Agent config, using the normal Agent-config default `medium` only when the field is absent. This configured value is the evaluation `thinking_level`; do not require or read thinking metadata from a Trace.

Before launch, snapshot every file under the Case's `statement/` and `rubric/` directories. Require a usable Rubric whose scoring items total exactly 100 points. Create a unique Workspace under `<test_agent_dir>/workspaces/`, resolve it to an absolute canonical path, and verify that the resolved path remains under that directory. Copy only `statement/` into it. The Test Agent may see the Statement and its own State, but never the Rubric, Gold answers, scoring rules, or Evaluator reasoning.

## Run and verify

Use an existing verified Penguin CLI or repository-local launcher. Do not install or probe a launcher. Snapshot the isolated Workspace and record the existing Trace files.

Resolve `PROJECT_DIR`, then derive and verify `PROJECT_ID`, then derive and verify `PENGUIN_HOME`. Perform these as separate shell statements in this order. Never compress the assignments onto one command line, derive a value before its input exists, or substitute another Penguin home. Before launch, confirm that `PROJECT_ID` equals the basename of `PROJECT_DIR` and `PENGUIN_HOME` equals its dirname.

Start one foreground execution with a fresh top-level Session. With an explicit pair, use:

```bash
PROJECT_DIR="<app_data_dir>"   # the App Data Dir value from your Environment section is the project root
PROJECT_ID="$(basename "$PROJECT_DIR")"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")"
export PENGUIN_HOME
penguin run \
  --message "Read README.md in the current Workspace and complete the task exactly as specified there." \
  --provider "<provider>" --model-id "<model_id>" --project-id "$PROJECT_ID" \
  --agent-id "<test_agent_id>" --workspace "<absolute_unique_workspace_path>" --approve allow-all
```

Use the exact requested Agent, Project, absolute Workspace path, and model pair. Never omit either model flag and never fall back to a Project default. If a launch fails, retry only when unchanged Workspace and Trace evidence proves that the Test Agent did not start. Every retry must follow a new diagnosis and apply a specific correction; never repeat an unchanged launch. Do not impose a numeric retry limit while distinct safe repairs remain. Return `evaluation_failed` when no new repair remains, external configuration is required, or it is unclear whether the Test Agent started.

Verify after the run that the State version, configured `model.thinking_level`, and both directory snapshots are unchanged. Return `version_changed` when the State version or configured thinking level differs and `benchmark_invalid` when the Statement or Rubric differs.

Inspect only new or changed Traces. Bind exactly one root Test Trace whose Workspace, Agent State path, provider, and model match this request. Ignore unrelated parallel Traces and exclude the root Trace's directly referenced child Sessions. Return `evaluation_failed` if there is no unique match. Read the actual non-empty `provider` and `model_id` from the bound root Trace's `session_meta`; return `evaluation_failed` if either is unavailable. Use the unchanged Target Agent configuration snapshot—not Trace metadata—for `thinking_level`.

## Score

Inspect only the isolated Workspace, the bound root Trace, its directly referenced child Traces, and the private Rubric. Apply every scoring item and allowed equivalent. Keep Rubric contents, Gold answers, per-item scoring, and scoring rationale private.

A wrong answer, missing artifact, malformed output, or task failure attributable to the Test Agent is scored behavior and returns `status: ok`. A launcher, Trace-binding, or Evaluator failure is not scored. Return `benchmark_invalid` when the Rubric cannot be applied and `evaluation_failed` when the score is non-finite or outside `0..100`.

The caller (`agent-optimization`) records a content-derived Agent fingerprint alongside each scoreboard evaluation via `penguin provenance`; the fingerprint's `version` must equal the `expected_version` you validate here. This leaf worker's return protocol is unchanged — do not compute or emit a fingerprint yourself.

Set `duration_ms` from the root Test Session. Compute cost only from reliable final cumulative usage or cost already recorded in that Session and directly referenced child Traces found in the same bounded pass. Never browse, query a pricing service, or infer cost from external model prices. If the required data is unavailable, return `cost: null`. Missing cost data must not invalidate a score.

Round `score` to two decimal places. Preserve a non-null `cost` at the precision recorded in the Trace; do not round it. Write `duration_ms` as a non-negative integer rounded to the nearest millisecond.

## Return

Return the required YAML as the only worker-authored text. Do not wrap it in backticks or a Markdown fence.

If the caller reports that your response formatting was invalid, use the scored or failed result already present in this Session and resend only the clean protocol YAML. Do not call tools, relaunch the Test Agent, rescore, or add an explanation.

For a scored result:

```text
protocol_version: 1
status: ok
case_id: <case_id>
run: <run>
expected_version: <version>
provider: <actual_provider>
model_id: <actual_model_id>
thinking_level: <configured_thinking_level>
score: <0_to_100>
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
thinking_level: <thinking_level_or_null>
failure_code: <stable_failure_code>
```

Use four failure codes:

- `invalid_request`: the request is incomplete or inconsistent.
- `benchmark_invalid`: the Statement, Rubric, or scoring contract is invalid.
- `version_changed`: the Test Agent version does not match the request or changed during evaluation.
- `evaluation_failed`: launch could not be safely repaired, or Trace binding or scoring failed.

Never include score, cost, duration, Session id, private data, or optimization advice on failure.
