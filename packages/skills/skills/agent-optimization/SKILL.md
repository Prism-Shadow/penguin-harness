---
name: agent-optimization
description: Improve an Agent State through versioned scores and score-linked Traces from a frozen Benchmark. Use when an explicit Test Agent has a complete current baseline; do not use for direct feedback, Benchmark construction, or direct scoring.
short_description: Improve an Agent from measured Benchmark results.
short_description_zh: 根据 Benchmark 结果改进 Agent。
version: 7
updated: 2026-07-28T07:56:18Z
---

# Agent Optimization

Improve one Test Agent through an evidence → hypothesis → Candidate → evaluation → accept or rollback loop. Use public Statements, scores, and Test Traces as black-box feedback. Delegate every evaluation to an `agent-evaluation` subagent; never run or score the Test Agent directly.

## Goal and contract

Require an explicit Test Agent and a frozen Benchmark with a complete valid Formal Baseline. The top-level Session must provide `run_subagent`, and the current Agent must have the `agent-evaluation` Skill. If prerequisite is missing, stop and explain what is needed. Do not evaluate the Test Agent directly.

A **Reference** is the Agent State currently kept as best, together with its complete Evaluation on the frozen Benchmark.

Each round starts from the Reference and tests a bounded, general **Candidate**. Evaluate every Candidate on the same frozen Case × Run matrix and evaluation Model. Accept it only when the change is admissible, the matrix is complete and valid, and its Evaluation's top-level `score` is strictly higher than the Reference Evaluation's `score`. An accepted Candidate and its Evaluation become the next Reference; otherwise restore the previous Reference.

## Access and changes

Inspect only the requested Test Agent and Benchmark: the Agent State, public Statements, Scoreboard, and score-linked Test Traces or artifacts from the Baseline and this optimization, including rejected Candidates.

Do not inspect Rubrics, Gold answers, private scoring conditions, Evaluator State, Workspace, or Trace, other Agents, or Project secrets. If private evaluation information enters the Optimizer context, restore the active Candidate and stop as contaminated.

Modify only the Test Agent State. Do not change the frozen Benchmark, Test Traces, or Project configuration. The only Benchmark write is appending a complete accepted Candidate Evaluation to `scoreboard.yaml`.

## Optimization loop

For each round:

1. **Establish the Reference.** Confirm that its complete Evaluation uses the frozen Case × Run matrix and evaluation Model and that its version matches the current Agent State.
2. **Diagnose capability gaps.** Compare each Case's `runs[].score` with its `max_score`; use the Evaluation's top-level `score` only for whole-version comparison. Use public Statements, score-linked Test Traces, and prior accepted or rejected attempts to identify observable behaviors that general Agent State changes could improve. Use repeated Runs to distinguish stable behavior from variation.
3. **State a falsifiable hypothesis.** Choose the related gaps to address, connect them to a bounded Candidate, and state which observable decisions or artifacts should change and why. A change that only adds analysis steps without predicting a behavioral change is not a useful hypothesis. Do not create a Candidate when no useful hypothesis remains.
4. **Create one Candidate from the Reference.** Apply the change and its Candidate version under the construction and rollback rules below. Do not carry rejected Candidate files into the next attempt.
5. **Check admissibility.** Confirm that the change is general, uses no private evaluation information, and modifies only permitted Test Agent State.
6. **Evaluate the Candidate.** Delegate the complete frozen Case × Run matrix in parallel under the evaluation rules below and assemble all returned cells. Do not modify the Candidate while any cell is in flight.
7. **Decide.** Accept the Candidate only when every cell is valid and its Evaluation's top-level `score` is strictly higher than the Reference Evaluation's `score`. Otherwise restore the Reference. A failure that prevents a valid comparison follows the stop rules below; it is not a zero score.
8. **Continue or stop.** An accepted Candidate becomes the next Reference. Use valid results from rejected Candidates only as evidence for a later hypothesis. Repeat until the user's target or round limit is reached, no useful Candidate remains, or infrastructure prevents a valid comparison.

## Build and roll back a Candidate

Create one Candidate per round from the current Reference. Put behavioral guidance in `AGENTS.md`, reusable target-owned capabilities in a focused Skill, and runtime limits in safe `system_config.yaml` fields. Do not edit `system_prompt` unless requested, or modify library-provided Skills for target-specific behavior.

Candidate version numbers only increase. Start with `Reference version + 1` and never reuse a rejected version. Before changing the Agent State, save the original contents and record any files the Candidate creates.

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

Inspect the complete streamed and final worker response. Accept a cell only when its worker-authored text is exactly one plain protocol YAML document. Narration, headings, code fences, summaries, or scoring details make the protocol invalid; do not extract YAML from them. Transport metadata added by `run_subagent` is not worker-authored text. If private evaluation information appears, follow the contamination rule above.

Correct and resend an `invalid_request`. Stop on `version_changed`, `benchmark_invalid`, `evaluation_failed`, or an invalid protocol.

## Record and report

Append each complete accepted Candidate Evaluation to `scoreboard.yaml` with the same field names as the Baseline:

```yaml
- time: <ISO-8601 timestamp>
  version: <Candidate version>
  provider: <provider>
  model_id: <model_id>
  summary_title: <public title>
  summary: <public summary>
  score: <sum of the Cases' average Run scores>
  cost: <sum of the Cases' average Run costs; null if any Run cost is unknown>
  duration_ms: <sum of the Cases' average Run durations>
  cases:
    - case: <case_id>
      max_score: <maximum score for one Run of this Case>
      runs:
        - score: <Run score>
          cost: <Run cost or null>
          duration_ms: <Run duration>
          session_id: <Test Session id>
```

Copy every Case's `max_score` unchanged from the Baseline. Do not add an `aggregate` object or use `case_id` or `mean_score`. Do not record rejected Candidates in the Scoreboard.

Report the Baseline and every fully evaluated Candidate with its score, version, change, decision, and Test Session ids. Include the final retained version, stop reason, and known limitations. Never report a score for an Agent State that was not evaluated.
