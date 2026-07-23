---
name: agent-tuning-pipeline
description: Orchestrate isolated Agent creation, Benchmark calibration, and Agent optimization through separate Penguin CLI Sessions.
short_description: Run an isolated Agent tuning pipeline.
short_description_zh: 编排隔离的 Agent 创建、评测与优化流程。
version: 1
updated: 2026-07-23T09:16:28Z
---

# Agent Tuning Pipeline

Coordinate a complete `create -> benchmark -> optimize` workflow. You are the coordinator, not a
phase worker: invoke dedicated Agents through separate `penguin run` Sessions, validate their
terminal protocols, and pass only explicit artifacts and identities between phases.

## Before you start

Require these task-specific inputs:

- target Agent id and a general capability brief;
- Benchmark id and capability to measure;
- Test Agent `(provider, model_id)`;
- baseline score interval and optimization target.

Use five Cases and two runs per Case unless the user supplies different positive integers. Use the
Project default Model for phase workers unless the user supplies a phase `(provider, model_id)`.
Ask only for a missing input that cannot be derived safely.

## Responsibility boundary

Do not use `agent-creation`, `benchmark-design`, `agent-evaluation`, or `agent-optimization`
yourself. Do not directly create or edit the target Agent, Benchmark, Scoreboard, snapshot, Rubric,
or evaluation Trace. Your writes are limited to private coordinator Workspaces, request files, and
logs outside all phase Workspaces.

Run these phase Agents sequentially in fresh top-level CLI Sessions:

1. `agent_creator`, with only `agent-creation`;
2. `benchmark_builder`, with only `benchmark-design`;
3. `agent_optimizer`, with only `agent-optimization`.

`agent_evaluator`, with only `agent-evaluation`, is an internal leaf used by Builder and Optimizer;
the coordinator never invokes it directly.

Never pass a phase transcript, Workspace, Memory, private Rubric, Gold answer, or reasoning to
another phase. A handoff consists only of the terminal protocol fields required by the next phase.
Separate Sessions and role boundaries provide functional isolation, not a filesystem security
boundary; never claim confidentiality against an Agent that can independently read unrestricted
project files.

## Resolve and verify the runtime

Derive paths only from the Environment's Project Dir:

```text
PROJECT_DIR = <project_dir>
PROJECT_ID = <basename_of_project_dir>
PENGUIN_HOME = <parent_of_project_dir>
```

Before running a phase:

- verify the `penguin` executable and selected Models;
- verify every role Agent exists at `<project_dir>/agents/<role_agent_id>`;
- verify each role Agent has its one required Skill at the version installed in `default_agent`;
- reject a legacy `<project_dir>/<agent_id>` path or compatibility symlink;
- ensure the requested target Agent id does not already exist before Creation.

Never call `penguin run --agent-id <id>` for a missing role Agent: the CLI may initialize an
ordinary empty Agent instead of the required role.

If a role Agent is absent, provision it before the workflow through a separate `default_agent` CLI
Session using `agent-creation`. Give it a generic role, install exactly its required phase Skill
from `default_agent`, and do not include the target capability, Benchmark, score, or Model. If an
existing role Agent has a mismatched Skill or non-generic State, stop instead of silently rewriting
it.

## Run one phase

Generate one opaque `workflow_id` and reuse it across all three phases. For each phase:

1. Create a fresh private Workspace and separate request, stdout, and stderr files. Set restrictive
   permissions on them.
2. Write exactly one scoped phase request from the templates below.
3. Run one foreground CLI process:

   ```bash
   PENGUIN_HOME="$PENGUIN_HOME" penguin run \
     --provider "$PHASE_PROVIDER" \
     --model-id "$PHASE_MODEL_ID" \
     --project-id "$PROJECT_ID" \
     --agent-id "$PHASE_AGENT_ID" \
     --workspace "$PHASE_WORKSPACE" \
     --message "$(<"$MESSAGE_FILE")" \
     --approve allow-all \
     >"$STDOUT_FILE" 2>"$STDERR_FILE"
   ```

4. Bind the result to the unique root Session/Trace matching the invocation's phase Agent,
   Workspace, start time, and phase Model. Extract the last completed assistant message from that
   root Session. Do not accept progress text, child output, or an arbitrary YAML block from noisy
   stdout.
5. Parse exactly one terminal `pipeline_protocol: 1` YAML document ending in
   `protocol_end: true`. Validate the workflow, project, phase, phase Agent, artifact identities,
   versions, and digests before continuing.

Do not run two business phases concurrently. Do not globally kill Penguin processes or blindly
rerun a phase after an ambiguous exit: it may already have mutated durable state. If the root
Session or terminal protocol cannot be bound uniquely, stop and report the phase and logs.

## Phase requests

### Creation

Give Creator only the general capability brief. Do not include the Benchmark id, Case design,
score targets, Test Model, or optimization goal.

```text
请使用 `agent-creation` Skill 完成以下独立阶段，并仅返回协议结果。

pipeline_protocol: 1
workflow_id: <workflow_id>
project_id: <project_id>
phase: creation
phase_agent_id: agent_creator
agent_id: <target_agent_id>
capability_requirement: |
  <general_capability_brief>
```

Continue only when Creation returns `status: ok`, `target_was_absent: true`,
`state_version: 1`, the canonical Agent path, and a State digest.

### Benchmark calibration

Pass Builder the accepted Creation identity plus the Benchmark-specific task. Do not include
Creator prose or State contents.

```text
请使用 `benchmark-design` Skill 完成以下独立阶段，并仅返回协议结果。

pipeline_protocol: 1
workflow_id: <workflow_id>
project_id: <project_id>
phase: benchmark
phase_agent_id: benchmark_builder
test_agent_id: <target_agent_id>
expected_state_version: <creation.state_version>
expected_state_digest: <creation.state_digest>
benchmark_id: <benchmark_id>
capability_to_measure: |
  <benchmark_capability_and_case_constraints>
test_provider: <test_provider>
test_model_id: <test_model_id>
case_count: <case_count>
runs_per_case: <runs_per_case>
baseline_score_min: <baseline_min>
baseline_score_max: <baseline_max>
```

Continue only when Builder returns a complete valid matrix, an accepted score inside the requested
interval, the unchanged State identity, and Benchmark-definition and Scoreboard digests. A
`calibration_failed` or out-of-band result is not a baseline for Optimization.

### Optimization

Pass Optimizer only the accepted Creation and Builder protocol fields plus the target score. Do not
include Rubrics, Gold answers, Builder reasoning, rejected candidates, or unlinked traces.

```text
请使用 `agent-optimization` Skill，以 Benchmark optimization mode 完成以下独立阶段，并仅返回协议结果。

pipeline_protocol: 1
workflow_id: <workflow_id>
project_id: <project_id>
phase: optimization
phase_agent_id: agent_optimizer
test_agent_id: <target_agent_id>
target_was_absent: true
creator_state_version: <creation.state_version>
creator_state_digest: <creation.state_digest>
benchmark_id: <benchmark_id>
reference_version: <benchmark.tested_state_version>
reference_state_digest: <benchmark.tested_state_digest>
benchmark_definition_digest: <benchmark.benchmark_definition_digest>
scoreboard_digest: <benchmark.scoreboard_digest>
reference_time: <benchmark.reference_time>
reference_provider: <benchmark.provider>
reference_model_id: <benchmark.model_id>
reference_score: <benchmark.score>
reference_evaluation_key: <benchmark.reference_evaluation_key>
case_count: <benchmark.case_count>
case_ids: <benchmark.case_ids>
runs_per_case: <benchmark.runs_per_case>
expected_cell_count: <benchmark.expected_cell_count>
target_score: <optimization_target>
```

Accept success only when Optimizer returns `status: optimized`, `target_met: true`, a complete
valid retest at or above the target, an unchanged Benchmark-definition digest, and final State and
Scoreboard digests. With no user-supplied round limit, do not add one.

## Final report

Report only:

- target Agent id and final tested version;
- Benchmark id, Case/run matrix, Test Model, and accepted baseline;
- accepted score curve and generalized Agent State changes;
- final score, stop reason, and artifact paths;
- any invalid cells or isolation/security limitations.

Do not reproduce private Rubrics, Gold answers, hidden mechanisms, phase chain-of-thought, or raw
phase transcripts.
