---
name: agent-optimization
description: Improve an Agent State through versioned scores and score-linked Traces from a frozen Benchmark. Use when an explicit Test Agent has a complete current baseline; do not use for direct feedback, Benchmark construction, or direct scoring.
short_description: Improve an Agent from measured Benchmark results.
short_description_zh: 根据 Benchmark 结果改进 Agent。
version: 6
updated: 2026-07-27T06:18:30Z
---

# Agent Optimization

Improve an existing Agent State using public Statements, scores, and Test Traces as black-box feedback. Delegate every Case and Run to a separate `agent-evaluation` worker; do not run or score the Test Agent directly.

## Workflow

1. Validate the target, Formal Baseline, frozen Benchmark, evaluation Model, and rollback prerequisites.
2. Analyze allowed evidence and state one falsifiable capability hypothesis.
3. Record affected files, make one minimal general Agent State change, and increment the version.
4. Delegate the complete evaluation matrix; immediately record a strictly higher Candidate or roll it back.
5. Repeat from each accepted Candidate, then report the score curve and stop reason.

## Setup and access

Require:

- an explicit Test Agent;
- an explicit Benchmark;
- a complete valid Formal Baseline in the Scoreboard;
- a top-level Session with `run_subagent`;
- the `agent-evaluation` Skill installed on the current Agent.

If `run_subagent` is absent, return `missing_run_subagent`. Never fall back to running or scoring the Test Agent directly. If the Formal Baseline or another requirement is missing, stop and explain what is needed; the Optimizer does not create a Baseline.

Use the Environment's App Data Dir:

```text
TARGET = <app_data_dir>/agents/<test_agent_id>
STATE = <target>/agent_state
TRACES = <target>/traces
BENCHMARK = <target>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark>/scoreboard.yaml
```

Do not read Project secrets, credentials, a vault, a private Rubric, Evaluator State, Evaluator Workspace, Evaluator Trace, or another Agent.

You may read the target Agent State, public Case Statements, the Scoreboard, and Test Traces and artifacts either referenced by the Scoreboard or identified by valid `agent-evaluation` results returned during this optimization. This includes runs from rejected Candidates.

Never read, search, list, or open a path under `rubric/`; use exact public Statement and Scoreboard paths instead of enumerating private Benchmark contents. If Rubric content, Gold answers, or private scoring conditions enter the Optimizer context, do not use them: restore any active Candidate and report the Session as contaminated.

Never modify the Benchmark config, Cases, Statements, supporting files, Rubrics, Gold answers, `runs`, Test Traces, Project configuration, or another Agent. The only permitted write inside the Benchmark is appending a complete accepted Candidate Evaluation to `scoreboard.yaml`.

## Optimization contract

Freeze the Case set, Statements, Rubrics, `runs`, and evaluation Model throughout optimization.

A Reference Evaluation must:

- match the current Agent State version;
- contain one non-empty `(provider, model_id)` pair;
- contain the complete Case × Run matrix.

Every Candidate Evaluation must use the same Benchmark, Cases, Runs, and exact `(provider, model_id)` pair as the Reference. Do not translate, alias, or fall back to another Model identifier.

A Candidate is comparable only when its Agent State and the frozen Benchmark remain unchanged and its evaluation matrix is complete and valid. Accept it only when its aggregate score is strictly higher than the Reference; otherwise reject it and restore the prior State. Record an accepted Candidate before using it as the next Reference.

## Create and restore a Candidate

Make the smallest complete edit supported by evidence and preserve unrelated content.

- Behavioral, role, workflow, and domain guidance normally belongs in `AGENTS.md`.
- A reusable capability shared across tasks may belong in a target-owned Skill.
- Runtime limits belong in the corresponding safe fields of `system_config.yaml`.
- Do not edit `system_prompt` unless the user explicitly asks.
- Do not modify a library-provided Skill to carry target-specific behavior.

Every change must generalize beyond observed instances. A Candidate may encode a stable environment policy only when repeated comparable evidence supports it. Do not encode Case ids, exact answers, per-question lookup tables, private scoring conditions, or a rule supported by one observation. Prefer conditional policies and validation procedures over memorized outputs.

Before changing Agent State, read the top-level `version` from `system_config.yaml`, defaulting to 1 when absent. Use `current + 1` as the candidate version. Record the exact original content of every file this round may change. Write candidate files through temporary files and validate them before replacing the originals.

If a Candidate is rejected or cannot complete a valid comparison:

- restore the files changed by the round;
- remove files created by the round;
- restore the previous version;
- verify the rollback.

If another process changes the Agent State, stop without overwriting its work.

## Delegate evaluation

The Optimizer owns the matrix, ledger, concurrency, and handling of returned failures. The Evaluator owns one `(case_id, run)` cell and may only retry a transient launch before Test Agent execution begins. Launch one independent `agent-evaluation` worker for each required cell.

Never dispatch a pending or valid cell. Correct and resend only `invalid_request`, which never launches the Test Agent. Do not redispatch `cli_failed`, because the Evaluator has exhausted its safe launch retry, or `provenance_mismatch`, because the Test Agent may already have run. Any other failure leaves the matrix incomplete and stops optimization. The Optimizer never repairs the frozen Benchmark.

Use bounded batches that fit the available subagent capacity. For each batch, launch its independent workers before waiting, then poll those exact subagent ids until the batch is complete.

Send each Evaluator one unambiguous request with every required identity field:

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

Accept one unambiguous protocol YAML document defined by `agent-evaluation` and ignore surrounding text. Never use Evaluator commentary, Rubric content, Gold answers, or per-item scoring to form a hypothesis or edit. If the protocol is invalid, fail the cell without redispatch because execution status is unknown.

## Optimization loop

For each round:

1. **Analyze evidence**

   Review the current Reference's aggregate and Case scores, repeated-run stability, public Statements, and Test Traces. Compare them with any fully evaluated Candidate from this optimization, including rejected Candidates, to identify behavioral differences. Start with representative failures and unusual variance; expand inspection only when the current evidence is insufficient.

2. **State a hypothesis**

   State one falsifiable hypothesis connecting an observed failure, a missing general capability, and the expected effect of a minimal edit. Stop if none is credible. Keep one behavioral strategy family per round; split independent strategies into separate Candidates.

3. **Create a Candidate**

   Follow the Candidate editing, versioning, and rollback rules above.

4. **Complete the evaluation**

   Delegate every required Case and Run in the frozen Benchmark and assemble the complete result matrix.

5. **Accept or roll back**

   Apply the comparison rule above. Immediately record and retain an accepted Candidate; fully restore a rejected or invalid Candidate.

Unless the user asks only for analysis, evaluate at least one credible Candidate when infrastructure permits.

Stop when the user's target or round limit is reached, no credible new hypothesis remains, or infrastructure prevents a valid comparison. Do not search the score by making random Agent State changes.

## Record and finish

Immediately after accepting a Candidate and before starting another round, append its complete Evaluation, including a public `summary_title` and `summary`, to the Scoreboard atomically. Keep rejected Candidates in the round ledger for analysis and the final report, but do not write a rejected, incomplete, or invalid Candidate Evaluation to the Scoreboard.

Report the score curve from the baseline through every fully evaluated Candidate, including rejected Candidates. Show it as a compact table and a simple visual curve such as Mermaid `xychart-beta` or an equivalent text chart. Also report accepted Agent State versions and main changes, rejected and rolled-back Candidates, Test Session ids, stop reason, and known limitations.

Distinguish evaluated Agent State from unscored changes. Never attribute a Scoreboard score to an Agent State that was not evaluated.
