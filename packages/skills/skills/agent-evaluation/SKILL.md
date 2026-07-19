---
name: agent-evaluation
description: Run and score exactly one Benchmark Case run with CLI execution, Trace provenance checks, and private Rubric isolation.
short_description: Run and score one isolated Benchmark Case.
short_description_zh: 隔离执行并评分一个 Benchmark Case。
version: 1
updated: 2026-07-17T17:08:17Z
---

# Agent Evaluation

Act as an internal leaf worker. For one valid request, run and score exactly one Benchmark Case once, then return minimal protocol metadata. Do not design or refine the Benchmark, modify the Test Agent State, or write `scoreboard.yaml`. Do not use `run_subagent` or `input_subagent`.

## Before you start

This Skill is invoked by `benchmark-design` or Benchmark mode in `agent-optimization`. Require one unambiguous protocol request containing every identity field below. If the request is missing, duplicated, or conflicting, return `invalid_request` without creating a Workspace or launching the Test Agent. Do not ask an interactive clarification from this leaf worker.

## Privacy boundary

Before the final protocol YAML, emit no assistant text; use private reasoning and tool calls only. Never serialize Statement or artifact contents, Rubric items, expected values, correct outcomes, per-item scoring, diagnostics, secret configuration, Workspace paths, or Trace paths into an assistant message. The final assistant message is the protocol YAML only. It may echo the public identity fields supplied by the caller.

A valid request contains exactly one value for each field:

```text
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <tested_agent_state_version>
test_agent_id: <test_agent_id>
benchmark_dir: <absolute_benchmark_dir>
provider: <provider>
model_id: <upstream_model_id>
```

## Validate and prepare

Resolve the Project, Test Agent, Benchmark, and Case only from the explicit request and Environment Project Dir. Reject traversal, symlink escape, or any path outside the requested Test Agent. Never read a Project configuration file, credential, or vault.

Require:

```text
<test_agent_dir>/agent_state/system_config.yaml
<benchmark_dir>/benchmark_config.toml
<benchmark_dir>/<case_id>/statement/README.md
<benchmark_dir>/<case_id>/rubric/README.md
```

Require `benchmark_config.toml` to contain a positive integer `runs`; the requested `run` must be within `1..runs`. The canonical State version is the top-level `version` in `system_config.yaml`, defaulting to 1, and must equal `expected_version`.

Read and retain the exact Statement and Rubric bytes before launch. Reject an unusable, contradictory, non-atomic, or unbounded Rubric. The Rubric must declare a finite Case maximum; the returned score must fall within `0..case_max`.

Create a collision-checked Workspace at `<test_agent_dir>/workspaces/tmp-<8hex>`. Copy only the contents of `statement/` into it. Never copy, link, or disclose `rubric/`, and never reuse another Case or run's Workspace.

## Launch and bind the Test Session

Use an existing verified Penguin CLI or repository-local launcher already available in the runtime. Do not install a CLI and do not use `penguin run` as a probe. If no launcher is available, return `cli_failed`.

Run the Test Agent exactly once in the foreground with a fresh top-level Session:

```bash
PROJECT_DIR="<project_dir>"
PROJECT_ID="$(basename "$PROJECT_DIR")"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")"
WORKSPACE="$PROJECT_DIR/agents/<test_agent_id>/workspaces/<unique_workspace_id>"
export PENGUIN_HOME
penguin run --message "Read README.md in the current Workspace and complete the task exactly as specified there." \
  --provider "<provider>" --model-id "<model_id>" --project-id "$PROJECT_ID" \
  --agent-id "<test_agent_id>" --workspace "$WORKSPACE" --approve allow-all
```

Use the exact Project, Test Agent, Model pair, and Workspace. Do not fall back to another value. Poll the same process until it exits. A nonzero, interrupted, or misrouted launch is `cli_failed`, not score zero. Do not relaunch within the same run or target processes by a global name or pattern.

Read the canonical State version before and after the Test run; any change is `version_changed`. Confirm the Statement and Rubric bytes are unchanged before scoring.

Search only the explicitly requested Test Agent's `traces/` tree and never inspect another Agent's traces. Group rotated shards by Session. Evaluate every Session group that could contain the exact Workspace match; never infer ownership from recency or a fixed-size latest subset. Bind the Test Trace mechanically from `session_meta`:

- `payload.workspace` equals the unique Workspace;
- `payload.agent_state` equals the exact Test Agent State path;
- `payload.provider` equals the requested provider;
- `payload.model_id` equals the requested model id.

When matching Test subagents exist, exclude child ids referenced by subagent events and require one unique matching root Test Session. Unrelated concurrent traces are not conflicts. Missing, multiple, malformed, or identity-mismatched roots are `provenance_mismatch`.

## Score and account

Inspect only the unique Test Workspace, its bound Test Trace, and the retained private Rubric. Apply every atomic item exactly and normalize only allowed equivalents. A missing, malformed, wrong-type, or incorrect Test artifact is ordinary scored Test Agent behavior: apply the Rubric's zero or partial credit and return `status: ok`. Only a changed or unusable Rubric, or a non-finite/out-of-range result, is `invalid_score`. Detailed reasoning remains in Evaluator Trace.

Compute `duration_ms` from the bound root Test Session, not from the Evaluator. Compute cost only from that root and child Sessions mechanically referenced by subagent events whose traces are available within the explicitly requested Test Agent's `traces/` tree. For each included Session, use final cumulative token usage rather than summing intermediate cumulative events, and apply the matching public `(provider, model_id)` pricing. If any referenced child trace or usage is unavailable there, including because the Test Session delegated to another Agent, or if any included usage is unpriced, return `cost: null` rather than inspecting another Agent or reporting a known partial sum as complete cost.

## Return protocol

Emit exactly one plain YAML document beginning with `protocol_version:` and stop. Do not use a code fence or add explanations.

On success:

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

On failure:

```text
protocol_version: 1
status: infrastructure_failure
case_id: <case_id>
run: <run>
expected_version: <version>
provider: <provider>
model_id: <model_id>
failure_code: <stable_failure_code>
```

Stable codes are `invalid_request`, `invalid_statement`, `invalid_rubric`, `cli_failed`, `provenance_mismatch`, `version_changed`, and `invalid_score`. Do not include score, cost, duration, Session id, private data, or optimization advice on failure.
