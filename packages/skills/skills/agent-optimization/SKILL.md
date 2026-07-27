---
name: agent-optimization
description: Improve an Agent State through versioned scores and score-linked Traces from a frozen Benchmark. Use when an explicit Test Agent has a complete current baseline; do not use for direct feedback, Benchmark construction, or direct scoring.
short_description: Improve an Agent from measured Benchmark results.
short_description_zh: 根据 Benchmark 结果改进 Agent。
version: 6
updated: 2026-07-27T05:39:01Z
---

# Agent Optimization

Improve an existing Agent State through measured Benchmark results. The Optimizer owns each Reference and Candidate evaluation matrix. For every required Case and Run index, delegate one execution and score to a separate `agent-evaluation` worker; do not run or score the Test Agent directly.

## Workflow

1. Validate the explicit target, frozen Benchmark, current complete Reference, evaluation Model, and rollback prerequisites.
2. Inspect score-linked evidence and state one falsifiable capability hypothesis.
3. Record candidate-owned originals, make one minimal Agent State change, and increment the version once.
4. Launch one `agent-evaluation` worker for each required Case and Run index, then assemble the complete frozen matrix.
5. Accept a strictly higher valid Candidate; otherwise restore and verify the prior State.
6. Use each accepted Candidate as the next Reference, then report the complete score curve and stop reason.

## Before you start

Require:

- an explicit Test Agent;
- an explicit Benchmark;
- a complete usable baseline in the Scoreboard;
- a top-level Session with `run_subagent`;
- the `agent-evaluation` Skill installed on the current Agent.

If `run_subagent` is absent, immediately return `missing_run_subagent`. Do not edit Agent State, launch the Test Agent through `penguin run`, score a Case, or use the generic "do the work yourself" fallback. If another requirement is missing, stop and explain what is needed rather than starting a change that cannot be compared completely.

## Target and access boundaries

Use the Environment's App Data Dir:

```text
TARGET = <app_data_dir>/agents/<test_agent_id>
STATE = <target>/agent_state
TRACES = <target>/traces
BENCHMARK = <target>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark>/scoreboard.yaml
```

Do not read Project secrets, credentials, a vault, a private Rubric, Evaluator State, Evaluator Workspace, Evaluator Trace, or another Agent.

You may read the target Agent State, public Case Statements, the Scoreboard, and Test Traces and artifacts explicitly referenced by the Scoreboard.

Never read, search, list, or open a path under a Case's `rubric/` directory. Use exact public Statement and Scoreboard paths rather than enumerating private Benchmark contents. If private Rubric content, Gold answers, or private scoring conditions enter the Optimizer context, the optimization Session is contaminated: do not use that information, do not retain or score a Candidate derived from it, restore any active Candidate, and report the result as invalid.

Never modify the Benchmark, Test Traces, Project configuration, or another Agent.

## Agent State editing policy

Make the smallest complete edit supported by evidence and preserve unrelated content.

- Behavioral, role, workflow, and domain guidance normally belongs in `AGENTS.md`.
- A reusable capability shared across tasks may belong in a target-owned Skill.
- Runtime limits belong in the corresponding safe fields of `system_config.yaml`.
- Do not edit `system_prompt` unless the user explicitly asks.
- Do not modify a library-provided Skill to carry target-specific behavior.

Every change must apply beyond a single observed instance. A Candidate may encode a stable environment-level policy learned through repeated black-box evaluation when that policy applies across multiple comparable instances in the frozen Benchmark. Do not encode Case ids, exact instance answers, per-question lookup tables, private scoring conditions, or a rule supported by only one observation. Prefer conditional policies and validation procedures over memorizing isolated outputs. Do not turn one high-scoring Trace's apparent choice into an unconditional rule.

## Snapshot, version, and rollback

Before changing Agent State, read the top-level `version` from `system_config.yaml`, defaulting to 1 when absent.

The system owns Agent State snapshot archives and exposes them through Web export and import. Do not create, import, extract, or replace snapshot archives yourself. Require this snapshot to exist:

```text
<target>/snapshots/v<version>.tar.gz
```

If the current-version snapshot is missing, stop and ask the user to export the current Agent State from Agent settings before continuing.

Use `current + 1` as the candidate version.

Before editing, record the exact original content of every file owned by the round. Write candidate files through temporary files and validate them before replacing the originals.

If a candidate is rejected or cannot complete a valid comparison:

- restore the files changed by the round;
- remove files created by the round;
- restore the previous version;
- verify the rollback.

If another process changes the Agent State, stop without overwriting its work.

## Optimization contract

Freeze the Case set, Statements, Rubrics, `runs`, and evaluation Model throughout optimization.

A Reference Evaluation must:

- match the current Agent State version;
- contain one non-empty `(provider, model_id)` pair;
- contain the complete Case × Run matrix.

If the current Agent State has no complete Evaluation, evaluate it without changing State and use that result as the Reference.

Every Candidate Evaluation must use the same Benchmark, Cases, Runs, and exact `(provider, model_id)` pair as the Reference. Do not translate, alias, or fall back to another Model identifier.

## Evaluation dispatch

The Optimizer, not the Evaluator, owns the matrix, ledger, concurrency, and retries. For each required `(case_id, run)` pair, launch one independent `agent-evaluation` worker. That worker runs the specified Test Agent on the specified Case exactly once, scores only that execution, returns one protocol result, and stops.

Never dispatch a pair that is already pending or valid, and retry it only after a retryable evaluation failure identified by its `failure_code`. Use bounded batches that fit the available subagent capacity. Launch all independent workers in one batch before waiting, then poll those exact subagent ids until the batch is complete.

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

Extract one unambiguous protocol YAML document with the fields defined by `agent-evaluation` and ignore any surrounding text. Never use Evaluator commentary, Rubric content, Gold answers, or per-item scoring to form an optimization hypothesis or Agent State edit. If no valid protocol can be extracted, treat the cell as an evaluation failure and retry it according to the ledger.

## Optimization loop

For each round:

1. **Analyze the Reference**

   Review the aggregate score, Case scores, and repeated-run stability. Start with representative failures, unusual variance, and their Test Traces; expand Trace inspection only when the current evidence is insufficient.

2. **State a hypothesis**

   State one falsifiable behavioral hypothesis that identifies the observed failure, the missing general capability, and the behavioral change expected from a minimal Agent State edit. Stop if no credible hypothesis remains. One round must isolate one behavioral strategy family; split independent strategy changes into separate Candidates rather than bundling them into one edit.

3. **Create a Candidate**

   Confirm the current-version snapshot, record the original candidate-owned files, make the smallest general edit, and use `current + 1` as the candidate version.

4. **Complete the evaluation**

   For each required Case and Run index in the frozen Benchmark, launch one separate `agent-evaluation` worker and assemble their results. The Candidate is comparable only when the Agent State and Benchmark remain unchanged and the matrix is complete and valid.

5. **Accept or roll back**

   If the Candidate score is strictly higher than the Reference, keep the Candidate State and append its Evaluation, including a public `summary_title` and `summary`, to the Scoreboard atomically. If the score is equal, lower, or cannot be compared validly, roll back the Candidate and do not write it to the Scoreboard.

Each accepted Candidate becomes the next Reference.

Unless the user asks only for analysis, evaluate at least one credible Candidate when infrastructure permits.

Stop when the user's target or round limit is reached, no credible new hypothesis remains, or infrastructure prevents a valid comparison. Do not search the score by making random Agent State changes.

## Final report

Report the score curve from the baseline through every fully evaluated Candidate, including rejected Candidates. Show it as a compact table and a simple visual curve such as Mermaid `xychart-beta` or an equivalent text chart. Also report accepted Agent State versions and main changes, rejected and rolled-back Candidates, Test Session ids, stop reason, and known limitations.

Distinguish evaluated Agent State from unscored changes. Never attribute a Scoreboard score to an Agent State that was not evaluated.
