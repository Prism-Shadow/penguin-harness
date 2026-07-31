---
name: agent-optimization
description: Improve an Agent State through versioned scores and score-linked Traces from a frozen Benchmark.
short_description: Improve an Agent from measured Benchmark results.
short_description_zh: 根据 Benchmark 结果改进 Agent。
version: 8
updated: 2026-07-31T04:10:53Z
---

# Agent Optimization

Improve one Test Agent through an evidence → hypothesis → Candidate → evaluation → accept or rollback loop. Use public Statements, scores, and Test Traces as black-box feedback. Delegate every evaluation to an `agent-evaluation` subagent; never run or score the Test Agent directly.

## Before you start

If the request does not identify the Test Agent, frozen Benchmark, desired target score, and round limit, ask for the missing inputs. When they are already supplied, proceed without asking the user to restate them.

## Goal and contract

Require an explicit Test Agent, a frozen Benchmark with a complete valid Formal Baseline, a desired target score, and a positive round limit. Read the evaluation `(provider, model_id, thinking_level)` from the complete Evaluation that matches the current Agent State; do not require the user to repeat it. An Evaluation without any part of this runtime is incomplete and cannot be used as a Reference. The top-level Session must provide `run_subagent`, and the current Agent must have the `agent-evaluation` Skill. If a prerequisite is missing, stop and explain what is needed. Do not create the missing Agent, Benchmark, or Baseline, and do not evaluate the Test Agent directly.

A **Reference** is the Agent State currently kept as best, together with its complete Evaluation on the frozen Benchmark.

Each round starts from the Reference and tests a bounded, general **Candidate**. Evaluate every Candidate on the same frozen Case × Run matrix and evaluation runtime. Accept it only when the change is admissible, the matrix is complete and valid, and its Evaluation's top-level `score` is strictly higher than the Reference Evaluation's `score`. An accepted Candidate and its Evaluation become the next Reference; otherwise restore the previous Reference. Stop early when the Reference reaches the desired target; otherwise run no more than the requested number of complete valid Candidate rounds.

## Access and changes

Resolve paths from the Environment's App Data Dir without recursively discovering the Project:

```text
PROJECT_DIR = <app_data_dir>
PROJECT_ID = <basename_of_project_dir>
PENGUIN_HOME = <parent_of_project_dir>
TARGET = <app_data_dir>/agents/<test_agent_id>
STATE = <target>/agent_state
TRACES = <target>/traces
BENCHMARK = <target>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark>/scoreboard.yaml
SNAPSHOTS = <target>/snapshots
```

Inspect only the requested Test Agent and Benchmark: the Agent State, public Statements, Scoreboard, and score-linked Test Traces or artifacts from the Baseline and this optimization, including rejected Candidates.

Do not inspect Rubrics, Gold answers, private scoring conditions, Evaluator State, Workspace, or Trace, other Agents, or Project secrets. If private evaluation information enters the Optimizer context, restore the active Candidate and stop as contaminated.

Modify only the Test Agent State and the versioned snapshot required to protect it. Do not change the frozen Benchmark, Test Traces, or Project configuration. The only Benchmark write is appending a complete accepted Candidate Evaluation to `scoreboard.yaml`.

## Optimization loop

For each round:

1. **Establish the Reference.** Confirm that its complete Evaluation uses the frozen Case × Run matrix and evaluation runtime and that its version matches the current Agent State.
2. **Diagnose capability gaps.** Compare each Case's `runs[].score` on the fixed `0..100` scale; use the Evaluation's top-level average `score` only for whole-version comparison. Use public Statements, score-linked Test Traces, and prior accepted or rejected attempts to identify observable behaviors that general Agent State changes could improve. Use repeated Runs to distinguish stable behavior from variation.
3. **State a falsifiable hypothesis.** Choose the related gaps to address, connect them to a bounded Candidate, and state which observable decisions or artifacts should change and why. A change that only adds analysis steps without predicting a behavioral change is not a useful hypothesis. If the current diagnosis is exhausted, use the remaining public evidence and prior attempts to construct a different admissible Candidate.
4. **Create one Candidate from the Reference.** Apply the change and its Candidate version under the construction and rollback rules below. Do not carry rejected Candidate files into the next attempt.
5. **Check admissibility.** Confirm that the change is general, uses no private evaluation information, and modifies only permitted Test Agent State.
6. **Evaluate the Candidate.** Delegate the complete frozen Case × Run matrix in parallel under the evaluation rules below and assemble all returned cells. Do not modify the Candidate while any cell is in flight.
7. **Decide.** Accept the Candidate only when every cell is valid and its Evaluation's top-level average `score` is strictly higher than the Reference Evaluation's `score`. Otherwise restore the Reference. Record separately whether the predicted Case behavior changed; a higher Evaluation score accepts the Candidate even when the stated hypothesis was not supported.
8. **Persist and continue.** Immediately append and verify every accepted Candidate Evaluation before starting another round. An accepted Candidate becomes the next Reference. Use valid results from rejected Candidates only as evidence for a later hypothesis. Stop when the Reference reaches the desired target. Otherwise complete the requested number of valid Candidate rounds unless infrastructure, contamination, concurrent State changes, or the inability to construct any admissible Candidate creates a concrete blocker. At the round limit, retain the highest-scoring accepted Reference.

A round counts only after one Candidate has a complete valid Evaluation. Corrected requests, validity repairs, and evaluation retries do not consume the round limit. A complete valid Evaluation of a rejected Candidate does count.

## Build and roll back a Candidate

Create one Candidate per round from the current Reference. Put behavioral guidance in `AGENTS.md`, reusable target-owned capabilities in a focused Skill, and runtime limits in safe `system_config.yaml` fields. Do not edit `system_prompt` unless requested, modify library-provided Skills for target-specific behavior, or change `model.thinking_level`; the Reference Scoreboard fixes the evaluation thinking level.

Candidate version numbers only increase. Start with `Reference version + 1` and never reuse a rejected version. Before changing the Agent State, save the original contents and record any files the Candidate creates.

Before changing each Reference State, ensure `<target>/snapshots/v<Reference version>.tar.gz` exists. Reuse it when present. Otherwise create it yourself before editing by atomically archiving `agent_state/` while excluding `.vault.toml`; validate the archived version and never overwrite an existing same-version snapshot. If snapshot creation fails, stop before changing Agent State and report the failure.

Keep the exact original-file record for fast in-round rollback.

If the Candidate is rejected or cannot be evaluated, restore the Reference files and version, remove files created by the Candidate, and verify the restoration. If another process changes the Agent State, stop without overwriting it.

## Delegate evaluation

For each Case × Run cell, call `run_subagent` with:

```text
Use the `agent-evaluation` Skill. Run the specified Test Agent on the specified Case exactly once, then score that single execution.
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <test_agent_state_version>
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
provider: <provider>
model_id: <model_id>
```

Inspect the complete streamed and final worker response. Before reading `status`, `score`, or any other protocol field, verify that the worker-authored text is exactly one plain protocol YAML document. Narration, headings, code fences, summaries, or scoring details are not valid protocol. Ask the same Evaluator to resend only the clean YAML from its existing result; do not rerun the Test Agent for a formatting repair and do not extract YAML from the invalid response yourself. Transport metadata added by `run_subagent` is not worker-authored text. If private evaluation information appears, follow the contamination rule above.

For every scored result, require its actual `provider`, `model_id`, and `thinking_level` to equal the Reference runtime. A mismatch invalidates the Candidate matrix and stops optimization; never compare or record scores produced under a different runtime.

Correct and resend an `invalid_request`. Stop on `version_changed` or `benchmark_invalid`.

For `evaluation_failed`, keep the same Candidate and incomplete matrix. Ask the same Evaluator to diagnose and repair the failed cell, then rerun only that cell when evidence proves the Test Agent did not start. Every retry must apply a new, specific repair; never repeat an unchanged request or launch, and do not impose a numeric retry limit while distinct safe repairs remain. Do not inspect private Evaluator State or abandon the Candidate to design the next version. Stop when no new safe repair remains, external configuration is required, or it is unclear whether the Test Agent started.

## Record and report

Append each complete accepted Candidate Evaluation to `scoreboard.yaml` immediately after acceptance and verify the stored version, score, matrix, and Session ids before continuing. Obtain the current UTC timestamp from the environment, for example with `date -u +"%Y-%m-%dT%H:%M:%SZ"`, rather than inferring UTC from a displayed local time. Use the same field names as the Baseline:

```yaml
- time: <ISO-8601 timestamp>
  version: <Candidate version>
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

After writing, parse the complete `scoreboard.yaml` and verify the appended Evaluation before reporting success or continuing.

Every Run and Case score is on the fixed `0..100` scale. Do not write `max_score`. Calculate and write every Case and Evaluation average directly in the Scoreboard: ignore `null` values when averaging cost and write `null` only when all contributing costs are unknown; round `score` averages to two decimal places, `cost` averages to six decimal places, and `duration_ms` averages to the nearest integer. These stored values are authoritative—do not add a server, frontend, script, or consistency check that recomputes or validates them. Do not add an `aggregate` object or use `case_id`, `mean_score`, `mean_cost`, or `mean_duration_ms`. Do not record rejected Candidates in the Scoreboard.

Report the Baseline and every fully evaluated Candidate with its score, version, change, decision, and Test Session ids. For each Candidate, distinguish the acceptance decision from whether its stated hypothesis was supported by the predicted Case behavior. Include the final retained version, stop reason, and known limitations. Never report a score for an Agent State that was not evaluated.
