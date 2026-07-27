---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark and establish a traceable Formal Baseline. Use when an explicit Test Agent and target capability need a new or revised Benchmark; stop after the baseline and do not optimize the Agent.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 5
updated: 2026-07-27T04:53:40Z
---

# Benchmark Design

Build a multi-Case Benchmark for one Test Agent, calibrate its difficulty, and record a complete Formal Baseline.

This Skill changes the Benchmark, never the Test Agent. It does not execute or score the Test Agent: delegate every evaluation with `run_subagent` to an independent worker explicitly instructed to use `agent-evaluation`. Stop after the baseline; do not begin optimization.

## Workflow

- A **Pilot** is a provisional evaluation used to improve the Benchmark. Its results never enter the Scoreboard.
- **Freeze** means the Cases, Statements, supporting files, Rubrics, Gold answers, points, `runs`, and evaluation Model stop changing.
- A **Formal Baseline** is a fresh evaluation of every frozen Case, repeated for every configured Run, on one unchanged Agent State version.

Follow this order:

1. Validate the Test Agent, target capability, evaluation Model, and evaluation access.
2. Define the observable behavior that demonstrates the capability and draft the smallest useful Pilot.
3. Delegate one evaluation per Pilot Case and diagnose why the Pilot is too easy, too hard, or measures the wrong behavior.
4. Adjust one difficulty dimension and rerun the affected Cases. Use at most three Pilot iterations.
5. Freeze the complete Benchmark after a final leak check.
6. Delegate the fresh complete Formal matrix, record one valid baseline, and report limitations.

## Setup

Require an explicit Test Agent id, the capability to measure, and one exact evaluation `(provider, model_id)` pair. Ask for any missing value; derive a short semantic Benchmark id if needed.

The current Session must provide `run_subagent`, and the current Agent must have `agent-evaluation` installed. If either is unavailable, stop; return `missing_run_subagent` for the missing tool. Never fall back to `penguin run` or score a Case yourself.

Use the Environment's App Data Dir:

```text
TEST_AGENT_DIR = <app_data_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <test_agent_dir>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark_dir>/scoreboard.yaml
```

Access only this Test Agent and Benchmark. Do not read another Agent, Project secrets, hidden configuration, or any Evaluator State, Workspace, or Trace. You may inspect only Test Traces and public artifacts identified by a successful Evaluator protocol.

Read the Test Agent State version from the top-level `version` in `agent_state/system_config.yaml`; use 1 only when it is absent.

## Files and Case design

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

`statement/` contains the task, public evidence, and required artifact. `rubric/` contains private scoring conditions and Gold answers. Both README files are required; either directory may include supporting files.

Create `benchmark_config.toml` with `title`, `description`, and `runs = 3`; use another positive Run count only when the user requests it. Select the exact evaluation Model before the first Pilot and keep it fixed through Formal. Initialize `scoreboard.yaml` with `evaluations: []`.

Before writing Cases, state the observable difference between an Agent that has the target capability and one that does not. Each Case must require that capability, not merely share its topic. A Statement provides the objective, available materials, and required artifact—but not reasoning, hidden mappings, Gold answers, or scoring conditions.

Rubric maxima across all Cases must total 100. Use atomic scoring items, explicit points, and meaningful partial credit.

A **leak check** compares every public Statement and supporting file with its private Rubric. Remove anything that reveals or paraphrases a hidden rule, mapping, expected outcome, Gold answer, or scoring condition. Run this check before the first Pilot, after each Pilot change, and immediately before freeze.

Pilot output may show what is too easy or hard; it must not decide what becomes correct:

- never choose or revise a rule, mapping, expected outcome, or Gold merely to contradict an observed answer or known default;
- choose latent environment rules through an Agent-independent procedure and keep them fixed within each evaluated iteration;
- never lower a score only by tightening the Rubric around an observed answer;
- if new behavior is scored, state it publicly and provide enough public evidence to make it answerable.

## Delegate every evaluation

For each Case × Run cell, call `run_subagent` and tell that worker to use `agent-evaluation` with:

```text
Use the `agent-evaluation` Skill and evaluate exactly this Case run.
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <test_agent_state_version>
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
provider: <provider>
model_id: <model_id>
```

Keep a ledger keyed by phase, Pilot iteration when applicable, Case, Run, and attempt. Never dispatch a pending or valid cell twice. Launch independent cells in bounded parallel batches, then wait for those exact subagent ids.

Accept only the protocol YAML defined by `agent-evaluation`; ignore commentary. Retry once only for `failure_code: cli_failed`. Any other failure, a second `cli_failed`, or an invalid protocol is terminal for that matrix. A terminal or incomplete Formal matrix cannot produce a baseline.

## Stage 1: Pilot calibration

1. Draft the smallest useful Pilot and delegate one representative evaluation per Case. This is iteration 1.
2. Record the Agent State version and fixed evaluation Model. Keep Pilot results out of the Scoreboard.
3. Before editing, record one diagnosis: why the Pilot is inadequate, the one difficulty dimension to change, and the capability failure that change should expose.
4. Change only that dimension. Typical dimensions include evidence volume, conflicts, distractors, cross-file dependencies, or decision depth. Update any affected Statement, material, Rubric, Gold answer, and points consistently.
5. Discard results invalidated by the change, run the leak check, and delegate new representative evaluations for the affected Cases. This begins the next iteration.

Stop when the user's gate is satisfied, after three iterations, or when no credible capability-relevant adjustment remains. If the gate is still missed, report the limitation instead of manufacturing ambiguity or arbitrary scoring strictness.

## Stage 2: Freeze and Formal Baseline

1. Freeze the complete Benchmark and run the final leak check.
2. Start a fresh ledger and record the current Agent State version.
3. Delegate every Case × Run cell; never reuse a Pilot run.
4. Accept the matrix only if every cell succeeds and the Agent State version remains unchanged.

Do not change the Benchmark after the first Formal cell is dispatched. If a genuine design defect appears, abandon the whole matrix and return to Pilot only if the three-iteration budget has room. Missing the score gate is not a design defect. After any permitted change, freeze again and rerun the entire Formal matrix.

Record a complete valid baseline even when it misses the gate, and report the miss as a calibration limitation. Record nothing from a partial, abandoned, or invalid matrix.

## Record and finish

Write only Formal results to `scoreboard.yaml`. Each Evaluation records `time`, Agent State `version`, `provider`, `model_id`, public `summary_title` and `summary`, aggregate `score`, `cost`, `duration_ms`, and nested Case and Run results. Each Case records its mean metrics; each Run records `score`, `cost`, `duration_ms`, and Test `session_id`. If any contributing cost is unknown, use `null` for the containing Case and Evaluation cost.

Validate the Scoreboard through a temporary file, then replace it atomically. A later material Benchmark change starts a new Pilot and invalidates results that are no longer comparable. Evaluators never write the Scoreboard.

Report the Benchmark path, configuration, Agent State version, aggregate and Case scores, Test Session ids, and limitations. Include one compact row per Pilot iteration: score, diagnosed capability gap, single difficulty adjustment, and freeze or stop reason.

Do not reveal Rubrics, Gold answers, hidden rules, per-item scores, or diagnostics that expose private scoring conditions. Stop after reporting the baseline; do not modify the Test Agent or begin optimization.
