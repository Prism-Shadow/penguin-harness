---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark with repeated independent evaluations and a traceable baseline.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 4
updated: 2026-07-23T09:09:56Z
---

# Benchmark Design

Create and calibrate a multi-Case Benchmark that discovers a specified Test Agent's capability boundary. Own the public Statements, private Rubrics, Case set, configuration, and final baseline. Do not modify the Test Agent State, launch the Test Agent directly, or score a Case yourself.

## Before you start

Require a Test Agent and the capability to measure. If either is missing, ask the user. A Benchmark
run requires a fresh top-level Session with `run_subagent` and a separately provisioned
`agent_evaluator` Agent. If this Session is already a subagent or the dedicated Evaluator is
unavailable, stop before creating a partial Benchmark.

Benchmark design is one complete phase. Freeze and record an accepted baseline, return its terminal
result, and stop. Do not invoke `agent-creation` or `agent-optimization`, modify the Test Agent, or
continue another pipeline phase in this Session.

## Boundaries

Access only the explicit Test Agent and Benchmark paths. Do not inspect another Agent, Project configuration files, Agent Evaluator State, Evaluator Workspace, or Evaluator Trace. The only allowed cross-Agent action is dispatching a protocol request to the dedicated `agent_evaluator`; consume only its terminal protocol response and returned Test Session id.

Before the first evaluation, do not read the Test Agent's `AGENTS.md`, Skills, Memory, Tools, prior
Traces, or prior Workspaces. Read only `system_config.yaml` for the canonical version and
mechanically compute the supplied State digest without printing State contents. After evaluation,
inspect only the score-linked Test Sessions returned for the current candidate. Do not read
Benchmark Builder's prior Trace, Memory, or Workspace from another workflow.

Use the Environment's Project Dir and the explicit Test Agent id:

```text
PROJECT_DIR = <project_dir>
PROJECT_ID = <basename_of_project_dir>
PENGUIN_HOME = <parent_of_project_dir>
TEST_AGENT_DIR = <project_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <project_dir>/agents/<test_agent_id>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark_dir>/scoreboard.yaml
```

Derive a semantic Benchmark id when the user does not supply one. Require `agent_state/system_config.yaml`; its top-level `version` is the canonical State version and defaults to 1 when absent.
In delegated pipeline mode, also require the Creator's `expected_state_version` and
`expected_state_digest`; recompute and match both before creating any Benchmark file.

## Benchmark contract

Use this structure:

```text
<benchmark_id>/
├── benchmark_config.toml
├── scoreboard.yaml
└── CASE-<nnn>-<semantic-name>/
    ├── statement/
    │   └── README.md
    └── rubric/
        └── README.md
```

Both README files are required; either directory may contain supporting files. `statement/` is the complete public task and evidence. `rubric/` is private scoring material. Never mention private criteria or paths in the Statement.

Create `benchmark_config.toml` first. The Model is deliberately not stored here; each evaluation records the actual `(provider, model_id)` pair.

```toml
title = "<benchmark_title>"
description = "<capability_and_scope>"
runs = 3
```

Use `runs = 3` unless the user explicitly requests another positive integer. Initialize the Scoreboard with:

```yaml
evaluations: []
```

Every accepted evaluation follows scoreboard v2:

```yaml
evaluations:
  - time: "2026-07-17T00:00:00Z"
    version: 1
    provider: deepseek
    model_id: deepseek-v4-pro
    summary_title: "Calibrated baseline"
    summary: "Abbreviated baseline schema for one Case with three independent runs."
    score: 18
    cost: 0.04
    duration_ms: 60000
    cases:
      - case: CASE-001-example
        score: 18
        cost: 0.04
        duration_ms: 60000
        runs:
          - score: 17
            cost: 0.03
            duration_ms: 58000
            session_id: session-1
          - score: 18
            cost: 0.04
            duration_ms: 60000
            session_id: session-2
          - score: 19
            cost: 0.05
            duration_ms: 62000
            session_id: session-3
```

Case `score`, `cost`, and `duration_ms` are the means of their valid `runs`. Evaluation totals are the sums of the Case means. Omit a Case or evaluation `cost` when any contributing run has unknown cost; never treat unknown as zero. Rubric maxima across the complete Case set must total exactly 100 points before any evaluation is dispatched. Recompute that sum after every material Case or Rubric revision. Never report a raw sum with another denominator as a score out of 100, and do not use post-hoc normalization to make an invalid point scale look compliant.

Builder writes one final baseline for the current Benchmark definition. A material change to a Statement, Rubric, Case set, or `runs` invalidates prior results: clear `evaluations`, recalibrate, and write a new baseline. Rejected candidates and provisional matrices remain only in Builder Trace. Evaluator never writes the Scoreboard.

The public `summary_title` and `summary` may describe the tested State, Case-level score patterns, and instability. They must not reveal Rubric or Gold content, expected answers, private scoring reasoning, mappings, thresholds, formulas, or rules.

## Design and calibrate

Before writing Cases, define the observable difference between an Agent that has the requested capability and one that does not. Each Case must make that capability causally necessary, not merely share its topic.

Run this counterfactual before accepting a Case: could a competent executor without the target capability complete it by mechanically following the Statement? If yes, reject or redesign it. A self-contained Statement specifies the task, available evidence, and required artifact without disclosing the reasoning, mapping, or rule the capability is supposed to recover. The evidence must still make the answer inferable.

Build several independent, realistic end-to-end Cases with distinct capability-relevant failure modes. Do not manufacture low scores through missing essential evidence, trivia, formatting traps, excessive workload, or unstable infrastructure.

Freeze every Rubric before evaluation. Use atomic observable conditions, exact points, reasonable equivalence rules, and meaningful partial credit. Test the Rubric mentally against full, partial, missing, malformed, wrong-type, and extra output. Never execute Test Agent-produced code while scoring.

Use valid evidence to calibrate toward a user-supplied target; otherwise aim near 60/100. A
user-supplied score interval is a hard acceptance gate: accept and freeze a baseline only when the
complete 100-point evaluation lies inside that interval. Treat an out-of-band or near-ceiling
candidate as uncalibrated while a credible structural refinement remains. Audit high scores for
shortcuts or leakage and low scores for ambiguity, missing evidence, unrelated difficulty, or a
defective Rubric. More items, steps, workload, or ambiguity alone are not structural refinement.
Do not hit the target by merely redistributing Rubric points or weakening partial credit after
seeing model answers; change the capability-relevant evidence, state interaction, or reasoning
path, freeze the revised Rubrics, and run a fresh complete matrix. Unless the user supplies a round
limit, there is no implicit calibration-round cap: continue while a credible structural redesign
remains.

## Select the evaluation Model

Use a user-specified `(provider, model_id)` pair when supplied. Otherwise resolve the Project default with the supported CLI, never by reading the hidden Project configuration:

```bash
penguin config model list --project-id "<project_id>" --root "<penguin_home>"
```

The row marked `*` is the default. Keep the same pair through all candidate matrices for this calibration. The pair selects the Test Agent's CLI Session, not the Builder or Evaluator runtime model.

## Run the Case-run matrix

Read and retain the exact State version, Scoreboard bytes, configured positive `runs`, selected Model pair, and complete valid Case set. Build every unique Case-run cell before dispatch.

Start one child per cell with `run_subagent` and set `agent_id: "agent_evaluator"` explicitly.
Never reuse Benchmark Builder as the Evaluator. Provide exactly one protocol request:

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

Build the complete N × R cell set before dispatch. Run it in deterministic parallel waves of at
most eight Evaluators, allocating every cell identity before the first wave. Do not inspect scores
or adapt later requests until every cell has terminated. Continue an active child through
`input_subagent`; never duplicate it.

Parse only the last terminal `protocol_version: 1` YAML mapping. Keep every identity-matched
`status: ok` result. Abort the matrix without retry on `invalid_request`, `invalid_statement`,
`invalid_rubric`, `version_changed`, or `invalid_score`. Retry at most once only for a transient
`cli_failed`, `provenance_mismatch`, or malformed/missing terminal protocol, using a fresh
Evaluator and Workspace with the same State, Model, Benchmark, and cell identity. Never retry a
valid scored cell. If any retry remains invalid, abandon the matrix.

An abandoned matrix contributes no cells to a later matrix. If the failure is an owned Statement
delivery or temporary Workspace problem, repair that cause and start a fresh complete matrix. If
the canonical Test Agent path or State is wrong, stop with that blocker. Never move or recreate the
Test Agent, create compatibility symlinks, or weaken provenance checks to make an evaluation run.

For a complete matrix, calculate Case means and evaluation sums using scoreboard v2. Retain every run's score, cost when known, duration, and Test Session id. Re-read State version and exact Scoreboard bytes; abandon the result if either changed.

Use each returned Test Session id to inspect the exact Test Trace and artifact. Analyze all repeated runs; disagreement is capability instability, not permission to select a convenient result. Accept a candidate only when the capability caused the scored difference, evidence was sufficient, the Rubric was sound, and useful headroom remains.

When an acceptable complete valid matrix is reached, write the final baseline to a temporary sibling, parse it as YAML, then atomically rename it over `scoreboard.yaml`. Include the sorted Case set and sorted runs, a real UTC ISO-8601 time, the tested version and Model pair, and a privacy-safe summary. An out-of-band matrix is a rejected candidate and remains in Builder/Evaluator Traces, not the Scoreboard. If no credible valid refinement remains, report `calibration_failed`, leave a new Benchmark's `evaluations` empty, and stop.

Report the Benchmark path, aggregate and Case scores, Test Session ids, refinements, stop reason, and limitations.

## Delegated phase protocol

When the request contains `pipeline_protocol: 1`, work non-interactively and make the final
assistant message exactly one plain YAML document. Emit no code fence or prose around it. Echo the
supplied `workflow_id`; never invent or alter it.

Before returning, compute:

- `tested_state_digest`: SHA-256 over sorted relative paths and bytes of regular files under the
  tested `agent_state/`, excluding `.vault.toml`;
- `benchmark_definition_digest`: the same deterministic digest over `benchmark_config.toml` and
  every Case `statement/` and `rubric/` file, excluding `scoreboard.yaml`;
- `scoreboard_digest`: SHA-256 of the final `scoreboard.yaml` bytes.

For either directory digest, hash the deterministic sequence of relative path, NUL, raw bytes, NUL.
Reconfirm that the Test Agent version and State digest did not change during calibration.

On success:

```text
pipeline_protocol: 1
workflow_id: <workflow_id>
project_id: <project_id>
phase: benchmark
phase_agent_id: benchmark_builder
status: calibrated
test_agent_id: <test_agent_id>
tested_state_version: <version>
tested_state_digest: <sha256>
benchmark_id: <benchmark_id>
benchmark_dir: <absolute_canonical_benchmark_dir>
benchmark_definition_digest: <sha256>
scoreboard_digest: <sha256>
reference_time: <scoreboard_evaluation_time>
provider: <provider>
model_id: <model_id>
score: <raw_0_to_100_score_inside_requested_interval>
case_count: <positive_integer>
case_ids: [<sorted_unique_case_id>, ...]
runs_per_case: <positive_integer>
expected_cell_count: <case_count_times_runs_per_case>
valid_cell_count: <same_as_expected_cell_count>
reference_evaluation_key: <time_version_provider_model_tuple>
protocol_end: true
```

If no acceptable candidate remains, return `status: calibration_failed` with the same identity,
version, Model, count, and digest fields when available, plus `last_valid_score` and
`failure_code: target_interval_not_reached`. For an invalid request or infrastructure blocker,
return `status: blocked` with `workflow_id`, `project_id`, `phase`, `phase_agent_id`, available
identity fields, a stable `failure_code`, and `protocol_end: true`. Never return `calibrated` for
an out-of-band score, incomplete matrix, changed State, or invalid Scoreboard.
