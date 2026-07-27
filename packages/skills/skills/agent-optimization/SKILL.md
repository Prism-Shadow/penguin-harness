---
name: agent-optimization
description: Improve an Agent State through versioned scores and score-linked Traces from a frozen Benchmark. Use when an explicit Test Agent has a complete current baseline; do not use for direct feedback, Benchmark construction, or direct scoring.
short_description: Improve an Agent from measured Benchmark results.
short_description_zh: 根据 Benchmark 结果改进 Agent。
version: 7
updated: 2026-07-27T11:08:12Z
---

# Agent Optimization

Improve one Test Agent using public Statements, scores, and Test Traces as black-box feedback. Delegate every evaluation to an `agent-evaluation` subagent; never run or score the Test Agent directly.

## Contract

Require an explicit Test Agent and a frozen Benchmark with a complete valid Formal Baseline. The top-level Session must provide `run_subagent`, and the current Agent must have the `agent-evaluation` Skill. If `run_subagent` is absent, return `missing_run_subagent`; if another prerequisite is missing, stop and explain what is needed. Do not create a Baseline or evaluate the Test Agent directly.

A **Reference** is the Agent State currently kept as best, together with its complete Evaluation on the frozen Benchmark. Initially, use the Agent State version recorded by the Formal Baseline and require it to match the current Agent State.

Evaluate every Candidate on the same frozen Case × Run matrix and evaluation Model. Accept it only when the matrix is complete and valid and its aggregate score is strictly higher than the Reference. An accepted Candidate and its Evaluation become the next Reference; otherwise restore the previous Reference.

## Evidence and boundaries

Access only the requested Test Agent and Benchmark. You may inspect the Agent State, public Statements, and Scoreboard. You may also inspect Test Traces and artifacts referenced by the Scoreboard or returned by valid evaluations in this optimization. This includes rejected Candidates.

Never inspect `rubric/`, Gold answers, private scoring conditions, Evaluator State, Evaluator Workspace, Evaluator Trace, another Agent, or Project secrets. If private evaluation information enters the Optimizer context, do not use it. Restore any active Candidate and report the Session as contaminated.

Modify only the Test Agent State. Do not change the Benchmark definition, Test Traces, or Project configuration. The only permitted Benchmark write is appending a complete accepted Candidate Evaluation to `scoreboard.yaml`.

## Candidate

Create one Candidate at a time with one bounded, general Agent State change. Use its scores and Test Traces to choose the next Candidate.

Put behavioral or workflow guidance in `AGENTS.md`. Put a reusable target-owned capability in a focused Skill. Put runtime limits in safe `system_config.yaml` fields. Do not edit `system_prompt` unless the user asks. Do not modify a library-provided Skill for target-specific behavior.

The change must generalize beyond observed instances. Do not encode Case ids, exact answers, per-question lookup tables, private scoring conditions, or a rule supported by one observation. Prefer conditional policies and validation procedures over memorized outputs.

Track the Reference version separately from Candidate attempt versions. The first Candidate uses `Reference version + 1`; each later Candidate uses the highest attempted Candidate version + 1, even if the previous Candidate was rejected. Rolling back restores the Reference version but never reuses a Candidate version. Record the exact original content of every affected file. Validate temporary files before replacing the originals.

If the Candidate is rejected or cannot be compared, restore the changed files and previous version. Remove files created by the round, then verify the rollback. If another process changes the Agent State, stop without overwriting its work.

## Delegate evaluation

The Optimizer owns the matrix, ledger, concurrency, and returned failures. Each Evaluator handles one `(case_id, run)` cell. It runs that cell once, scores it privately, and returns one protocol result. It may retry only a launch that failed before the Test Agent started.

Track every cell and attempt. After the Candidate is complete, list the full Case × Run matrix as `queued`. Mark a cell `in_flight` when dispatched and `completed` only after a valid result. Never dispatch an `in_flight` or valid `completed` cell again. Do not group the queue by Case or wait for all Runs of one Case or a whole batch to finish.

Dispatch from one queue across all Cases, using `yield_time_ms: 1000`. At the concurrency limit, poll with short yields and dispatch the next queued cell as soon as any worker finishes. Wait for the remaining workers only after the queue is empty. Do not modify the Candidate while any cell is in flight.

Send each Evaluator:

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

Across the worker's streamed and final responses, accept only one protocol YAML document. Transport status metadata added by `run_subagent` is not commentary; any worker-authored narration makes the protocol invalid. If that narration contains Rubric content, Gold answers, private scoring conditions, or per-item scoring, restore any active Candidate and report the Session as contaminated.

For `invalid_request`, correct the request and resend it. For `version_changed`, discard the matrix and stop. `benchmark_invalid`, `evaluation_failed`, or an invalid protocol leaves the matrix incomplete and stops optimization. Never redispatch the cell, convert a failure to score zero, or repair the frozen Benchmark.

## Iterate and report

For each round:

1. Use the available scores, public Statements, Test Traces, and prior attempts to create one bounded, general Candidate from the Reference.
2. Delegate the complete Case × Run matrix in parallel and assemble all returned cells.
3. If the Candidate score is strictly higher, keep it. Append its complete Evaluation with public `summary_title` and `summary` to the Scoreboard atomically, then use it as the next Reference. Otherwise restore the prior State. Keep rejected Candidates only in the round ledger.
4. Repeat until the user's target or round limit is reached, no useful Candidate remains, or infrastructure prevents a valid comparison.

Unless the user asks only for analysis, evaluate at least one Candidate when infrastructure permits.

Report the score curve from the Baseline through every fully evaluated Candidate, accepted or rejected. Include accepted versions and changes, rejected and rolled-back Candidates, Test Session ids, the stop reason, and known limitations. Never attribute a score to an Agent State that was not evaluated.
