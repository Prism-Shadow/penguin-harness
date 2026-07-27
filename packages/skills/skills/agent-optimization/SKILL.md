---
name: agent-optimization
description: Improve an Agent State through versioned scores and score-linked Traces from a frozen Benchmark. Use when an explicit Test Agent has a complete current baseline; do not use for direct feedback, Benchmark construction, or direct scoring.
short_description: Improve an Agent from measured Benchmark results.
short_description_zh: 根据 Benchmark 结果改进 Agent。
version: 7
updated: 2026-07-27T09:12:00Z
---

# Agent Optimization

Improve one Test Agent using public Statements, scores, and Test Traces as black-box feedback. Delegate every evaluation to an `agent-evaluation` subagent; never run or score the Test Agent directly.

## Contract

Require an explicit Test Agent and a Benchmark with a complete valid Formal Baseline. The top-level Session must provide `run_subagent`, and the current Agent must have the `agent-evaluation` Skill. If `run_subagent` is absent, return `missing_run_subagent`. If anything else is missing, stop and explain what is needed. Do not create a Baseline or fall back to direct evaluation.

Resolve only the requested Test Agent and Benchmark under the `Project Dir` from the Environment. Freeze the Cases, Statements, supporting files, Rubrics, Gold answers, `runs`, and evaluation `(provider, model_id)` throughout optimization.

The Reference must match the current Agent State version and contain a complete Case × Run matrix. Run every Candidate on the same frozen Benchmark with the same evaluation Model. Do not change the Candidate or Benchmark during evaluation. If the matrix is incomplete or invalid, reject the Candidate. Keep it only when its aggregate score is strictly higher than the Reference.

## Evidence and boundaries

Access only the requested Test Agent and Benchmark. You may inspect the Agent State, public Statements, and Scoreboard. You may also inspect Test Traces and artifacts referenced by the Scoreboard or returned by valid evaluations in this optimization. This includes rejected Candidates.

Never inspect `rubric/`, Gold answers, private scoring conditions, Evaluator State, Evaluator Workspace, Evaluator Trace, another Agent, or Project secrets. If private evaluation information enters the Optimizer context, do not use it. Restore any active Candidate and report the Session as contaminated.

Modify only the Test Agent State. Do not change the Benchmark definition, Test Traces, or Project configuration. The only permitted Benchmark write is appending a complete accepted Candidate Evaluation to `scoreboard.yaml`.

## Candidate

State one falsifiable hypothesis from the available evidence. Name the observed failure, the missing general capability, and the expected effect of one minimal Agent State change. Keep one behavioral strategy family per round.

Put behavioral or workflow guidance in `AGENTS.md`. Put a reusable target-owned capability in a focused Skill. Put runtime limits in safe `system_config.yaml` fields. Do not edit `system_prompt` unless the user asks. Do not modify a library-provided Skill for target-specific behavior.

The change must generalize beyond observed instances. Do not encode Case ids, exact answers, per-question lookup tables, private scoring conditions, or a rule supported by one observation. Prefer conditional policies and validation procedures over memorized outputs.

Before editing, read the top-level State `version`; use 1 when it is absent. Set the Candidate version to `current + 1`. Record the exact original content of every affected file. Validate temporary files before replacing the originals.

If the Candidate is rejected or cannot be compared, restore the changed files and previous version. Remove files created by the round, then verify the rollback. If another process changes the Agent State, stop without overwriting its work.

## Delegate evaluation

The Optimizer owns the matrix, ledger, concurrency, and returned failures. Each Evaluator handles one `(case_id, run)` cell. It runs that cell once, scores it privately, and returns one protocol result. It may retry only a launch that failed before the Test Agent started.

Track every cell and attempt. After the Candidate is complete, list the full Case × Run matrix as `queued`. Mark a cell `in_flight` when dispatched and `completed` only after a valid result. Never dispatch an `in_flight` or valid `completed` cell again. Do not group the queue by Case or wait for all Runs of one Case or a whole batch to finish.

Call `run_subagent` with a short initial yield such as `yield_time_ms: 1000` so each Evaluator continues in the background and returns its subagent id promptly. Dispatch every queued cell before polling when the tool permits it. If the tool enforces a hard concurrency limit, poll only until one slot opens, immediately dispatch the next queued cell, and repeat until the queue is empty. Do not report a queued cell as running or modify the Candidate while any cell is in flight.

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

Accept one unambiguous protocol YAML document and ignore surrounding text. Never use Evaluator commentary, Rubric content, Gold answers, or per-item scoring as optimization evidence.

For `invalid_request`, correct the request and resend it. For `version_changed`, discard the matrix and stop. `benchmark_invalid`, `evaluation_failed`, or an invalid protocol leaves the matrix incomplete and stops optimization. Never redispatch the cell, convert a failure to score zero, or repair the frozen Benchmark.

## Iterate and report

For each round:

1. Analyze the Reference's aggregate and Case scores, repeated-run stability, public Statements, and Test Traces. Compare them with completed Candidates from this optimization, including rejected ones.
2. State one credible hypothesis and create one Candidate under the rules above. Stop if no credible hypothesis remains.
3. Delegate the complete Case × Run matrix in parallel and assemble all returned cells.
4. If the Candidate score is strictly higher, keep it. Append its complete Evaluation with public `summary_title` and `summary` to the Scoreboard atomically, then use it as the next Reference. Otherwise restore the prior State. Keep rejected Candidates only in the round ledger.
5. Repeat until the user's target or round limit is reached, no credible hypothesis remains, or infrastructure prevents a valid comparison.

Unless the user asks only for analysis, evaluate at least one credible Candidate when infrastructure permits. Do not search the score through random Agent State changes.

Report the score curve from the Baseline through every fully evaluated Candidate, accepted or rejected. Include accepted versions and changes, rejected and rolled-back Candidates, Test Session ids, the stop reason, and known limitations. Never attribute a score to an Agent State that was not evaluated.
