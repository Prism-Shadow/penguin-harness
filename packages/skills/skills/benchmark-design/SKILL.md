---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark with repeated independent evaluations and a traceable baseline.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 15
updated: 2026-07-24T08:49:25Z
---

# Benchmark Design

Create and calibrate a multi-Case Benchmark for a specified Test Agent to measure a target
capability and establish a traceable baseline.

This Skill owns the Statements, Rubrics, Case set, Benchmark configuration, and baseline. Do not
modify the Test Agent State, run or score the Test Agent directly, or begin Agent optimization.
Delegate every individual evaluation and score to the `agent-evaluation` Skill.

## Before you start

Require both the Test Agent and the capability to measure. If either is missing, ask the user.

Evaluation also requires a top-level Session with `run_subagent`, and the current Agent must have
the `agent-evaluation` Skill installed. If either condition is missing, stop and explain the
blocker rather than creating a Benchmark that cannot be completed.

## Paths and access boundaries

Use the Environment's Project Dir and the explicit Test Agent id:

```text
TEST_AGENT_DIR = <project_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <test_agent_dir>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark_dir>/scoreboard.yaml
```

Derive a short semantic Benchmark id when the user does not supply one.

Access only the explicit Test Agent and Benchmark. Do not read another Agent, Project secrets,
hidden configuration, Evaluator State, Evaluator Workspace, or Evaluator Trace. You may inspect a
Test Trace and artifact when an Evaluator returns the corresponding Test Session id.

The top-level `version` in `agent_state/system_config.yaml` is the Test Agent State version and
defaults to 1 when absent.

## Benchmark files

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

Both README files are required; either directory may contain supporting files.

- `statement/` contains the task and evidence visible to the Test Agent.
- `rubric/` contains scoring conditions and Gold answers that the Test Agent must not see.

Never mention the Rubric, private paths, scoring conditions, or Gold answers in a Statement.

`benchmark_config.toml` contains at least:

```toml
title = "<benchmark_title>"
description = "<capability_and_scope>"
runs = 3
```

Use `runs = 3` unless the user explicitly requests another positive integer. Initialize the
Scoreboard with:

```yaml
evaluations: []
```

Evaluations use this basic structure:

```yaml
evaluations:
  - time: <ISO 8601>
    version: <Agent State version>
    provider: <provider>
    model_id: <model_id>
    score: <total score>
    cases:
      - case: <case_id>
        score: <mean score across runs>
        runs:
          - score: <single-run score>
            duration_ms: <Test Agent duration>
            session_id: <Test Session id>
```

The Rubric maxima across all Cases must total 100 points.

## Case and Rubric design

Before designing Cases, define the observable behavioral difference between an Agent that has the
target capability and one that does not. Each Case must genuinely depend on the target capability,
not merely share its topic.

A Statement describes:

- the task objective;
- the available materials;
- the required artifact.

Do not directly provide reasoning, mappings, or rules that the Agent is expected to derive.

Fix every Rubric before the first evaluation. After evaluation begins, do not change Gold answers,
scoring rules, or established point allocations in response to Test Agent answers.

Use atomic, observable scoring items with explicit points and meaningful partial credit for
reasonable partially correct results. Never execute Test Agent-produced code while scoring.

## Calibration

1. Complete and freeze the Cases, Statements, Rubrics, points, `runs`, and evaluation Model.
2. Record the current Test Agent State version and use `agent-evaluation` to complete every
   configured Case × Run.
3. A matrix may form a baseline only when every Case and Run is valid and complete and the Test
   Agent State version remains unchanged.
4. Use Case scores, repeated-run stability, and representative Test Traces to decide whether the
   Benchmark needs adjustment. Do not read every Trace indiscriminately.
5. A material change to a Statement, Rubric, Case set, or `runs` invalidates the old result and
   requires a new complete evaluation.
6. Respect the user's calibration target and adjustment budget. Do not revise indefinitely merely
   to hit an exact score.

Use the same `(provider, model_id)` pair throughout one calibration.

## Write the baseline

After a complete valid matrix, validate the updated Scoreboard through a temporary file and replace
`scoreboard.yaml` atomically.

If the complete matrix misses the user's preferred score range, still record the measured baseline
and report the calibration limitation. Leave `evaluations: []` only when no complete valid matrix
exists.

A public Scoreboard summary may describe scores, stability, and capability performance, but must
not reveal Rubrics, Gold answers, or private scoring rules.

When the Benchmark definition changes materially, the Builder must clear results that are no
longer comparable and establish a new baseline. Evaluator never writes the Scoreboard.

## Final report

Report the Benchmark path, configuration, Test Agent State version, aggregate and Case scores,
Test Session ids, main adjustments, and known limitations.

The report must not describe Rubrics, Gold answers, hidden rules, per-item scores, specific Test
Agent errors, or any diagnostic that could reveal private scoring conditions.

Stop after writing and reporting the baseline. Do not modify the Test Agent or begin Agent
optimization.
