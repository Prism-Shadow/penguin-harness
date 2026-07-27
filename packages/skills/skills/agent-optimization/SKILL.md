---
name: agent-optimization
description: Improve an Agent State through versioned scores and score-linked Traces from a frozen Benchmark. Use when an explicit Test Agent has a complete current baseline; do not use for direct feedback, Benchmark construction, or direct scoring.
short_description: Improve an Agent from measured Benchmark results.
short_description_zh: 根据 Benchmark 结果改进 Agent。
version: 6
updated: 2026-07-27T06:27:03Z
---

# Agent Optimization

Improve one Test Agent using public Statements, scores, and Test Traces as black-box feedback. Delegate every evaluation to an `agent-evaluation` subagent; never run or score the Test Agent directly.

## Contract

Require an explicit Test Agent, an explicit Benchmark with a complete valid Formal Baseline, a top-level Session with `run_subagent`, and the `agent-evaluation` Skill. If `run_subagent` is absent, return `missing_run_subagent`. If anything else is missing, stop and explain what is needed; the Optimizer does not create a Baseline or fall back to direct evaluation.

Resolve only the requested Test Agent and Benchmark under the Environment App Data Dir. Freeze the Cases, Statements, supporting files, Rubrics, Gold answers, `runs`, and evaluation `(provider, model_id)` throughout optimization.

The Reference must match the current Agent State version and contain one complete Case × Run matrix. Every Candidate must use the same frozen Benchmark and exact evaluation Model. A Candidate is comparable only when its Agent State and Benchmark remain unchanged and its matrix is complete and valid. Accept it only when its aggregate score is strictly higher than the Reference; otherwise roll it back.

## Evidence and boundaries

Access only the requested Test Agent and Benchmark. You may inspect the Agent State, public Statements, Scoreboard, and Test Traces or artifacts referenced by the Scoreboard or valid `agent-evaluation` results from this optimization, including rejected Candidates.

Never inspect `rubric/`, Gold answers, private scoring conditions, Evaluator State, Evaluator Workspace, Evaluator Trace, another Agent, or Project secrets. If private evaluation information enters the Optimizer context, do not use it: restore any active Candidate and report the Session as contaminated.

Modify only the Test Agent State. Do not change the Benchmark definition, Test Traces, or Project configuration. The only permitted Benchmark write is appending a complete accepted Candidate Evaluation to `scoreboard.yaml`.

## Candidate

Use the available evidence to state one falsifiable hypothesis connecting an observed failure, a missing general capability, and the expected effect of one minimal Agent State change. Keep one behavioral strategy family per round.

Place behavioral or workflow guidance in `AGENTS.md`, reusable target-owned capabilities in a focused Skill, and runtime limits in safe `system_config.yaml` fields. Do not edit `system_prompt` unless the user asks, and do not modify a library-provided Skill for target-specific behavior.

The change must generalize beyond observed instances. Do not encode Case ids, exact answers, per-question lookup tables, private scoring conditions, or a rule supported by one observation. Prefer conditional policies and validation procedures over memorized outputs.

Before editing, read the top-level State `version`, defaulting to 1, and use `current + 1` for the Candidate. Record the exact original content of every affected file, then validate temporary files before replacing the originals.

If the Candidate is rejected or cannot be compared validly, restore changed files and the previous version, remove files created by the round, and verify the rollback. If another process changes the Agent State, stop without overwriting its work.

## Delegate evaluation

The Optimizer owns the matrix, ledger, concurrency, and returned failures. Each Evaluator owns one `(case_id, run)` cell, executes it once, scores it privately, and returns one protocol result. It may retry only a transient launch that failed before Test Agent execution began.

Track every cell and attempt. Never dispatch a pending or valid cell. Use bounded parallel batches; launch each batch before waiting, then poll those exact subagent ids.

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

Correct and resend only `invalid_request`, which never launches the Test Agent. Do not redispatch `cli_failed`, because the Evaluator exhausted its safe launch retry, or `provenance_mismatch`, because the Test Agent may already have run. An invalid protocol or any other evaluation failure leaves the matrix incomplete and stops optimization; never convert it to score zero or repair the frozen Benchmark.

## Iterate and report

For each round:

1. Analyze the Reference's aggregate and Case scores, repeated-run stability, public Statements, and Test Traces. Compare them with completed Candidates from this optimization, including rejected ones.
2. State one credible hypothesis and create one Candidate under the rules above. Stop if no credible hypothesis remains.
3. Delegate every Case and Run in the frozen Benchmark and assemble the complete matrix.
4. If the Candidate score is strictly higher, immediately append its complete Evaluation with public `summary_title` and `summary` to the Scoreboard atomically and use it as the next Reference. Otherwise restore the prior State. Keep rejected Candidates only in the round ledger.
5. Repeat until the user's target or round limit is reached, no credible hypothesis remains, or infrastructure prevents a valid comparison.

Unless the user asks only for analysis, evaluate at least one credible Candidate when infrastructure permits. Do not search the score through random Agent State changes.

Report the score curve from the Baseline through every fully evaluated Candidate, accepted or rejected. Include accepted versions and changes, rejected and rolled-back Candidates, Test Session ids, the stop reason, and known limitations. Never attribute a score to an Agent State that was not evaluated.
