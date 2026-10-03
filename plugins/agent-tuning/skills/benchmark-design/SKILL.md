---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark and establish a traceable Formal Baseline.
---

# Benchmark Design

If an applicable reference conflicts with this SKILL.md, follow the reference
because it is more specific. Within its scope, a method or benchmark recipe also
takes precedence over Penguin defaults; user instructions take precedence over
both. Read only applicable references, record overrides, and report any behavior
that Penguin's actual interfaces cannot support.

Build a capability Benchmark for a specified Target/Test Agent. The Builder owns
case design and calibration; fresh Evaluator workers run and score individual
cells. Keep the Target Harness fixed and stop after the Benchmark and baseline
handoff. Optimization is a separate phase.

## Before you start

Use [Penguin](references/penguin.md) by default for Pilot calibration, difficulty
refinement and acceptance. A supplied custom design recipe can define another
policy; record its inputs, repeat count, budget and selection/publish rules before
evaluation. Reproducing existing tasks belongs to `benchmark-reproduction`.

Resolve the Target ID, target capability, Benchmark ID and the selected recipe's
required settings. Ask only for missing inputs. Resolve a complete evaluation
provider/model pair from the user or the Builder Session Environment, never an
implicit Project default. Reject a half pair. Read thinking from the Target config
(default medium when absent) and freeze that runtime and State version throughout.

## Files and access

Use Environment App Data Dir:

```text
TEST_AGENT_DIR = <app_data_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <app_data_dir>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark_dir>/scoreboard.yaml
```

The Benchmark is Project-level, beside `agents/`. Inspect only the specified
Target, this Benchmark and permitted outputs/traces of its evaluations. Do not
read Project secrets, other Agents or Evaluator private workspaces and reasoning.
Read State version from `system_config.yaml`, defaulting to 1 only when absent.

```text
<benchmark_id>/
  benchmark_config.toml
  scoreboard.yaml
  CASE-<id>/
    statement/README.md
    rubric/README.md
```

Create config fields `title`, `description`, `runs` and `status = "draft"`, and
initialize `scoreboard.yaml` with `evaluations: []`. The recipe defines `runs` and
when draft becomes published or failed. Each public Statement defines the task,
materials, required artifact and access boundary. Its private Rubric defines
observable scoring items totaling 100, partial credit and any gold/private standard.
Supporting files stay in the appropriate directory. Do not expose gold or private
scoring conditions in Statement. Runtime prerequisites, reset, scoring and cleanup
instructions belong in the Rubric when the task needs them.

## Construct and calibrate

1. State the observable capability, available evidence, weaker behavior or shortcut,
   and reusable Target behavior the Benchmark should measure.
2. Build the recipe's initial case set. Review Statement/Rubric consistency and
   public/private separation before each changed revision is evaluated. Keep the
   scoring standard fixed for that revision; do not edit gold after seeing an answer.
3. Delegate the complete case/run matrix. Keep Benchmark inputs and Target State
   immutable while workers are running. Preserve artifacts, bound sessions and
   results; infrastructure failures do not become zero scores.
4. Apply the recipe's revision and selection rules using valid measurements. Reuse
   a result only when its case, scoring, State and runtime are unchanged.
5. Freeze the selected Benchmark revision and record only its complete valid
   baseline. Partial or rejected matrices do not become a Formal Baseline.

## Delegate evaluation

Require `run_subagent` and an installed `agent-evaluation` Skill. Dispatch independent
Case × Run cells in parallel up to available concurrency, each with a fresh worker:

```text
Use agent-evaluation and its applicable references. Run and score this cell once.
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <test_agent_state_version>
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
provider: <provider>
model_id: <model_id>
```

Verify that streamed/final worker text is one plain protocol YAML document before
consuming fields. A formatting repair asks the same worker to resend its saved
result without tools, rerunning or rescoring; do not extract YAML from narration.
Transport metadata is not worker-authored text. Match the returned Agent, case,
run, version, actual provider/model and configured thinking to the request.

Correct `invalid_request`. Handle `benchmark_invalid` with a recorded repair and
new measurement of the affected revision. On `version_changed`, discard the current
matrix and wait for stable State. For `evaluation_failed`, retry only if evidence
proves the Target did not start and a new specific repair exists; otherwise stop
and report the blocker. Never retry a completed wrong answer to raise its score.

## Record and report

Write the selected recipe's complete accepted baseline with its observed UTC time:

```yaml
evaluations:
  - time: <ISO-8601 timestamp>
    agent_id: <test_agent_id>
    version: <Agent State version>
    provider: <provider>
    model_id: <model_id>
    thinking_level: <thinking_level>
    summary_title: >-
      <public title>
    summary: >-
      <public summary>
    score: <average of the Case scores>
    cost: <average of known Case costs, or null when every Case cost is null>
    duration_ms: <average of the Case durations>
    cases:
      - case: <case_id>
        score: <average of the Run scores>
        cost: <average of known Run costs, or null when every Run cost is null>
        duration_ms: <average of the Run durations>
        runs:
          - score: <Run score>
            cost: <Run cost or null>
            duration_ms: <Run duration>
            session_id: <Test Session id>
```

Compute run means per case and case means overall. Store score means to two
decimals, known-cost means to six (all unknown is null), and integer millisecond
duration means; preserve each run's recorded cost precision. Do not add `max_score`,
`aggregate` or a second runtime that recomputes stored averages. Parse the whole
scoreboard to verify the written structure, identity and session references.

Set the recipe's final status and validate config. Report Benchmark path, chosen
recipe, State/runtime, case coverage, baseline scores and sessions, revisions,
selection rationale, failures and limitations. Keep private gold, per-item scores
and Evaluator reasoning out of the public report. Stop before Agent optimization.
