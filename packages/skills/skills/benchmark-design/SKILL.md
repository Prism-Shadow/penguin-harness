---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark with repeated independent evaluations and a traceable baseline.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 5
updated: 2026-07-27T00:00:00Z
---

# Benchmark Design

Create and calibrate a multi-Case Benchmark for a specified Test Agent to measure a target
capability and establish a traceable baseline.

This Skill owns the Statements, Rubrics, Case set, Benchmark configuration, and baseline. Do not
modify the Test Agent State, run or score the Test Agent directly, or begin Agent optimization.
Delegate every individual evaluation and score to the `agent-evaluation` Skill.

## Before you start

Require the Test Agent, the capability to measure, and the evaluation `(provider, model_id)` pair.
If any is missing, ask the user.

Evaluation also requires a top-level Session with `run_subagent`, and the current Agent must have
the `agent-evaluation` Skill installed. If `run_subagent` is absent, immediately return
`missing_run_subagent`. Do not create or modify a Benchmark, launch the Test Agent through
`penguin run`, score a Case, or use the generic "do the work yourself" fallback. If the Skill is
missing, stop and explain the blocker rather than creating a Benchmark that cannot be completed.

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

Use `runs = 3` unless the user explicitly requests another positive integer. Select one exact
evaluation `(provider, model_id)` pair before the first evaluation and keep it fixed throughout
calibration. Record the pair on each Scoreboard Evaluation. Initialize the Scoreboard with:

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
    summary_title: <one_line_public_summary>
    summary: <public_evaluation_summary>
    score: <total score>
    cost: <total cost or null>
    duration_ms: <total duration>
    cases:
      - case: <case_id>
        score: <mean score across runs>
        cost: <mean cost or null>
        duration_ms: <mean duration>
        runs:
          - score: <single-run score>
            cost: <number or null>
            duration_ms: <Test Agent duration>
            session_id: <Test Session id>
```

The Rubric maxima across all Cases must total 100 points. If any contributing run has unknown cost,
use `null` for its Case and evaluation cost rather than treating it as zero.

## Case and Rubric design

Before designing Cases, define the observable behavioral difference between an Agent that has the
target capability and one that does not. Each Case must genuinely depend on the target capability,
not merely share its topic.

A Statement describes:

- the task objective;
- the available materials;
- the required artifact.

Do not directly provide reasoning, mappings, or rules that the Agent is expected to derive.

During Pilot calibration, Statements, supporting materials, Rubrics, Gold answers, Case sets, and
point allocations may change. Every such change invalidates the previous Pilot result and requires a
new Pilot evaluation and a new semantic isolation review before that evaluation.

Do not lower the score by tightening only the Rubric around an observed Test Agent answer. When a
new scoring expectation is necessary, make the required behavior clear in the Statement, ensure the
public evidence makes it answerable, update the Rubric consistently, and rerun the Pilot.

Use atomic, observable scoring items with explicit points and meaningful partial credit for
reasonable partially correct results. Never execute Test Agent-produced code while scoring.

Before the first evaluation, and after every Pilot change before its rerun, perform a semantic
isolation review of every public Statement and supporting file against its private Rubric. Public
material may describe the task, available evidence, required artifact, and any rules intentionally
given to the Test Agent; it must not state or paraphrase a rule, mapping, expected outcome, Gold
answer, or scoring condition that the Test Agent is meant to recover. Remove runtime-generated
answers or other accidental leaks before freezing the Benchmark. Repeat this review across the
complete final Case set immediately before freeze and Formal dispatch.

## Evaluation dispatch

Maintain a Case × Run ledger keyed by phase, Pilot iteration when applicable, Case, and Run. Never
dispatch a cell that is already pending or valid. Key attempts; retry only one time, only for the
clearly transient `cli_failed` infrastructure-failure code. Treat every other failure code, or a
second failure, as terminal for the current Pilot or Formal matrix. A terminal or incomplete matrix
must not write a baseline. Use bounded batches that fit the available subagent capacity. For
independent cells in one batch, launch one `agent-evaluation` subagent per cell before waiting for
any of them to finish, then poll those exact subagent ids until the batch is complete. Do not wait
for one cell to finish before launching the next independent cell.

Send each Evaluator one unambiguous request with every required identity field:

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

Extract one unambiguous protocol YAML document with the fields defined by `agent-evaluation` and
ignore any surrounding text. Do not copy Evaluator commentary into the Scoreboard or final report.
If no valid protocol can be extracted, treat the cell as terminal; do not retry it.

## Pilot calibration

Use Pilot evaluations to adjust difficulty before running the Formal Baseline.

1. Draft the smallest useful Pilot Case set that exercises the target capability.
2. Record the current Test Agent State version and evaluate one representative run per Pilot Case
   with `agent-evaluation`. This initial draft-and-evaluate pass is Pilot iteration 1. Keep the
   selected exact `(provider, model_id)` pair fixed.
3. Pilot results are provisional and must not be written to the Scoreboard.
4. Review the Case scores and only the representative Test Traces needed to explain them. Before
   editing the Benchmark, state:
   - why the current Pilot is too easy, too hard, or otherwise insufficient;
   - the one difficulty dimension to adjust;
   - the capability failure the adjustment is expected to expose.
5. In one iteration, adjust only one difficulty dimension. Prefer structural changes such as evidence
   volume, implicit conflicts, distractors, cross-file dependencies, or multi-step decisions.
6. Each one-dimension adjustment followed by its representative rerun is the next Pilot iteration;
   never perform multiple adjustment/rerun cycles inside one iteration. After any Statement,
   material, Rubric, Gold, Case-set, or point change, discard the previous Pilot result, perform the
   required semantic isolation review, and rerun the affected Pilot Cases.
7. Run no more than three Pilot iterations. Stop earlier when the Pilot satisfies the user's stated
   gate condition. If the third iteration does not satisfy the user's stated gate condition, or no
   credible capability-relevant adjustment remains, report the limitation instead of manufacturing
   ambiguity or arbitrary scoring strictness.

## Formal baseline

1. Once Pilot calibration is complete, discard or retire all Pilot ledger entries and results,
   finalize and freeze the Cases, Statements, supporting materials, Rubrics, Gold answers, points,
   `runs`, and evaluation Model, and complete the final semantic isolation review.
2. Start a fresh Formal ledger, record the current Test Agent State version, and use
   `agent-evaluation` to dispatch a fresh complete Case × Run matrix; never reuse Pilot outputs in
   the Scoreboard.
3. A matrix may form a baseline only when every Case and Run is valid and complete and the Test
   Agent State version remains unchanged.
4. After the first Formal Baseline cell is dispatched, do not change the frozen Benchmark. If a
   design defect is discovered, abandon that Formal Baseline and return to Pilot calibration only
   within the remaining three-iteration budget; otherwise report the limitation and do not write an
   invalid or partial baseline. A score that does not satisfy the target is not by itself a design
   defect. Rerun the complete Formal Baseline after an allowed adjustment.

Use the selected exact `(provider, model_id)` pair throughout Pilot calibration and the Formal
Baseline.

## Write the baseline

After a complete valid matrix, validate the updated Scoreboard through a temporary file and replace
`scoreboard.yaml` atomically.

If the complete matrix does not satisfy the user's stated gate condition, still record the measured
baseline and report the calibration limitation. Leave
`evaluations: []` only when no complete valid matrix exists.

A public Scoreboard summary may describe scores, stability, and capability performance, but must
not reveal Rubrics, Gold answers, or private scoring rules.

After a completed Formal Baseline, a material Benchmark change starts a new Pilot calibration. Clear
results that are no longer comparable before establishing the next Formal Baseline. Evaluator never
writes the Scoreboard.

## Final report

Report the Benchmark path, configuration, Test Agent State version, aggregate and Case scores,
Test Session ids, main adjustments, and known limitations.

The report must not describe Rubrics, Gold answers, hidden rules, per-item scores, specific Test
Agent errors, or any diagnostic that could reveal private scoring conditions.

Stop after writing and reporting the baseline. Do not modify the Test Agent or begin Agent
optimization.
