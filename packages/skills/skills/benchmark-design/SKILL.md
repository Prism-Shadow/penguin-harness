---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark with repeated independent evaluations and a traceable baseline.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 3
updated: 2026-07-22T14:52:46Z
---

# Benchmark Design

Create and calibrate a multi-Case Benchmark that discovers a specified Test Agent's capability boundary. Own the public Statements, private Rubrics, Case set, configuration, and final baseline. Do not modify the Test Agent State, launch the Test Agent directly, or score a Case yourself.

## Before you start

Require a Test Agent and the capability to measure. If either is missing, ask the user. A Benchmark run also requires a top-level Session with `run_subagent` and the current Agent must have `agent-evaluation` installed. If the Skill is missing or this Session is already a subagent, stop and ask the user to install the Skill or start a top-level Session. Do not begin a partial Benchmark.

When this is the middle stage of an explicit create → benchmark → optimize request, freeze and
record an accepted calibrated baseline as usual, then continue to `agent-optimization` in the same
top-level conversation. The accepted Case set, Statements, Rubrics, run count, and baseline Model
become the fixed comparison surface; optimization must not reshape them. Do not hand off an
out-of-band candidate or a `calibration_failed` result. Keep the baseline calibration interval
distinct from the later optimization target score and hand both values forward explicitly.

## Boundaries

Access only the explicit Test Agent and Benchmark paths. Do not inspect another Agent, Project configuration files, Agent Evaluator State, Evaluator Workspace, or Evaluator Trace. Consume only each Evaluator's terminal protocol response and the returned Test Session id.

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

Start one child per cell with `run_subagent`, and omit `agent_id` so the child reuses the current Agent. Each prompt must begin with the caller identity and the sentence: Use the `agent-evaluation` Skill. Then provide exactly one request:

```text
Caller agent: <current_agent_id>
Use the `agent-evaluation` Skill. Return only its terminal protocol YAML.
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <tested_agent_state_version>
test_agent_id: <test_agent_id>
benchmark_dir: <absolute_benchmark_dir>
provider: <provider>
model_id: <upstream_model_id>
```

For N Cases and R runs, emit all N × R independent `run_subagent` calls in the same parallel tool-call group before waiting for results. Continue an active child through `input_subagent`; never duplicate it.

Parse only the last terminal `protocol_version: 1` YAML mapping. Keep every identity-matched `status: ok` result. Retry only invalid cells once, with all retry cells dispatched together and the same State version, Model, Benchmark, and run identities. Never retry a valid scored cell. If any retry remains invalid, abandon the matrix.

An abandoned matrix contributes no cells to a later matrix. If the failure is an owned Statement
delivery or temporary Workspace problem, repair that cause and start a fresh complete matrix. If
the canonical Test Agent path or State is wrong, stop with that blocker. Never move or recreate the
Test Agent, create compatibility symlinks, or weaken provenance checks to make an evaluation run.

For a complete matrix, calculate Case means and evaluation sums using scoreboard v2. Retain every run's score, cost when known, duration, and Test Session id. Re-read State version and exact Scoreboard bytes; abandon the result if either changed.

Use each returned Test Session id to inspect the exact Test Trace and artifact. Analyze all repeated runs; disagreement is capability instability, not permission to select a convenient result. Accept a candidate only when the capability caused the scored difference, evidence was sufficient, the Rubric was sound, and useful headroom remains.

When an acceptable complete valid matrix is reached, write the final baseline to a temporary sibling, parse it as YAML, then atomically rename it over `scoreboard.yaml`. Include the sorted Case set and sorted runs, a real UTC ISO-8601 time, the tested version and Model pair, and a privacy-safe summary. An out-of-band matrix is a rejected candidate and remains in Builder/Evaluator Traces, not the Scoreboard. If no credible valid refinement remains, report `calibration_failed`, leave a new Benchmark's `evaluations` empty, and stop the composed workflow before optimization.

Report the Benchmark path, aggregate and Case scores, Test Session ids, refinements, stop reason, and limitations.
