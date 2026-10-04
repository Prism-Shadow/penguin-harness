# Penguin evaluation

Default platform recipe for `agent-evaluation`. Use the parent Skill's request,
execution boundaries and result protocol. A benchmark reference adds its runtime
and scoring details; it does not replace this launch recipe unless it says so.

## Resolve paths and configuration

Use Environment App Data Dir and the explicit request:

```text
PROJECT_DIR = <app_data_dir>
TEST_AGENT_DIR = <project_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <project_dir>/benchmarks/<benchmark_id>
CASE_DIR = <benchmark_dir>/<case_id>
```

The Benchmark belongs to the Project, beside `agents/`. Require
`agent_state/system_config.yaml`, `benchmark_config.toml`,
`<case_id>/statement/README.md` and `<case_id>/rubric/README.md`. A Benchmark with
`status = "failed"` is `benchmark_invalid`. Read only the requested identity and
materials; Project config and vaults are not needed.

Read the integer State `version`, defaulting to 1 only when absent, and require
`expected_version`. Read `model.thinking_level` from the Target config, defaulting
to `medium` only when absent. Snapshot that value; never infer it from Trace
metadata. The request supplies provider/model; Penguin does not store that pair
in Agent State. Ignore the Benchmark's total Run count: `run` is the caller's label.

Hash persistent State excluding `.vault.toml`, plus this Case's Statement and
Rubric. Include memory, Skills, tools and hooks so unversioned writes are visible.
Create a unique canonical Workspace under `<test_agent_dir>/workspaces/` and copy
only `statement/` into it. Keep evaluator scratch and any runtime preparation in
this cell's private directory outside the Test Workspace.

## Launch

With companion supervision, use the linked
[create-before-start procedure](../../agent-supervision/references/penguin.md#start-a-cli-target-pair)
so the Supervisor binds the Target before its first task. It replaces the direct
creation command below; all identity, workspace, source and usage rules still apply.
The direct command documents Penguin's underlying launch behavior, not permission
to bypass the companion when an Agent Tuning Skill requires one.

Use an existing verified Penguin CLI or repository-local launcher. Do not install or probe a launcher. Record the existing Trace files before launch.
Use the injected connection variables without printing their values. Do not dump
the environment, model configuration or credential files to diagnose a launch.

Resolve `PROJECT_DIR`, then derive and verify `PROJECT_ID`, then derive and verify `PENGUIN_HOME`. Perform these as separate shell statements in this order. Never compress the assignments onto one command line, derive a value before its input exists, or substitute another Penguin home. Before launch, confirm that `PROJECT_ID` equals the basename of `PROJECT_DIR` and `PENGUIN_HOME` equals its dirname.

Start one foreground execution with a fresh top-level Session. With an explicit pair, use:

```bash
set -eu
PROJECT_DIR="<app_data_dir>"   # the App Data Dir value from your Environment section is the project root
PROJECT_ID="$(basename "$PROJECT_DIR")"
PENGUIN_HOME="$(dirname "$PROJECT_DIR")"
export PENGUIN_HOME
TEST_WORKSPACE="<absolute_unique_workspace_path>"
test -n "$TEST_WORKSPACE"
test -d "$TEST_WORKSPACE"
test -f "$TEST_WORKSPACE/README.md"
penguin run \
  --message "Read README.md and complete the task. Use only this Workspace's task files, fixed Agent State and the declared public business interfaces. Keep all task scratch files in this Workspace. Do not inspect other workspaces, traces, benchmark sources, graders, private runtime files or process metadata. Do not modify persistent Agent State." \
  --provider "<provider>" --model-id "<model_id>" --project-id "$PROJECT_ID" \
  --agent-id "<test_agent_id>" --workspace "$TEST_WORKSPACE" \
  --thinking "<configured_thinking_level>" --approve allow-all --source benchmark
```

Resolve and validate the workspace inside the same shell or script that launches
the Target. A generated script cannot read an unexported variable from its parent.
Reject an unset or empty workspace; it must never fall back to the Evaluator's
working directory. Confirm the created Session records that exact canonical path
before accepting any output.

Pass the configured thinking level explicitly so Evaluator defaults cannot replace
it. For stored `none`, omit the unsupported CLI flag and clear only
`PENGUIN_SESSION_ID` on the launch command to disable caller inheritance; retain
the explicit model, Agent, Project and Workspace flags and authentication.

`--source benchmark` files the Test Session under the Evaluations folder of the Web App's session list rather than the Test Agent's active conversations; never omit it.

## Bind the Trace and report usage

Use the launch's Session ID. Inspect new `session_meta` headers only as needed to
bind one root with the exact Workspace, Agent State path, provider and model.
Do not display unrelated task content or read old runs to learn the trace format.
A child needs an actual parent launch relationship; the same Agent and nearby
timestamps do not establish one. No unique matching root or missing runtime
identity is `evaluation_failed`.

Raw JSONL records use `session_meta.payload` for execution identity.
`model_msg.payload.type` distinguishes text, thinking, tool_call and tool_call_output.
Parse a call's `arguments` JSON and pair its output by `tool_call_id`. Inspect the
bound root and its linked children against the parent Skill's access rules.

Return actual provider/model from the bound root's `session_meta`, thinking from
the unchanged configuration snapshot, and duration from the root Session. Use
only monetary cost reliably recorded for this Session and its linked children;
otherwise return `cost: null`. Token counts alone do not establish dollars. Do not
query pricing, platform databases or unrelated traces to fill the optional field.

## Default scoring

Apply every item and allowed equivalent in this Case's private Rubric, whose
weights total exactly 100. Keep item scores, gold and scoring reasoning private.
An executable grader declared by the Rubric is authoritative; follow its artifact
argument, accepted exit codes, output format and score conversion. Do not replace
it with an LLM regrade. Without an executable grader, assess the saved output
against the Rubric's stated criteria. An unusable Rubric is `benchmark_invalid`;
a failed scoring process or non-finite/out-of-range score is `evaluation_failed`.
