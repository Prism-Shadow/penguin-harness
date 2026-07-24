---
name: agent-optimization
description: Improve an Agent State from direct feedback or versioned Benchmark scores and score-linked Traces.
short_description: Improve an Agent from feedback or measured Benchmark results.
short_description_zh: 根据反馈或 Benchmark 结果改进 Agent。
version: 17
updated: 2026-07-24T11:19:26Z
---

# Agent Optimization

Improve an existing Agent State.

Use one of two modes:

- **One-shot feedback mode** makes one change from direct user feedback.
- **Benchmark optimization mode** makes measured improvements from Benchmark scores.

Determine the mode before editing any file. Do not mix the two execution paths.

In Benchmark mode, delegate every evaluation and score to the `agent-evaluation` Skill. Optimizer
must not run or score the Test Agent directly.

## Before you start

One-shot mode requires a target Agent and concrete feedback or a problem to correct.

Benchmark mode requires:

- an explicit Test Agent;
- an explicit Benchmark;
- a complete usable baseline in the Scoreboard;
- a top-level Session with `run_subagent`;
- the `agent-evaluation` Skill installed on the current Agent.

If `run_subagent` is absent, immediately return `missing_run_subagent`. Do not edit Agent State,
launch the Test Agent through `penguin run`, score a Case, or use the generic "do the work
yourself" fallback. If another requirement is missing, stop and explain what is needed rather than
starting a change that cannot be compared completely.

## Target and access boundaries

Use the Environment's Project Dir:

```text
TARGET = <project_dir>/agents/<test_agent_id>
STATE = <target>/agent_state
TRACES = <target>/traces
BENCHMARK = <target>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark>/scoreboard.yaml
```

Do not read Project secrets, credentials, a vault, a private Rubric, Evaluator State, Evaluator
Workspace, Evaluator Trace, or another Agent.

In Benchmark mode, you may read the target Agent State, public Case Statements, the Scoreboard,
and Test Traces and artifacts explicitly referenced by the Scoreboard.

Never modify the Benchmark, Test Traces, Project configuration, or another Agent.

## Agent State editing policy

Make the smallest complete edit supported by evidence and preserve unrelated content.

- Behavioral, role, workflow, and domain guidance normally belongs in `AGENTS.md`.
- A reusable capability shared across tasks may belong in a target-owned Skill.
- Runtime limits belong in the corresponding safe fields of `system_config.yaml`.
- Do not edit `system_prompt` unless the user explicitly asks.
- Do not modify a library-provided Skill to carry target-specific behavior.

Every change must generalize beyond the observed run. Do not encode Case ids, expected answers,
Benchmark-specific constants, private scoring conditions, or rules that apply to only one Case.
Prefer improving general analysis, validation, and execution methods over memorizing Benchmark
answers. Do not turn one high-scoring Trace's apparent choice into an unconditional domain rule;
prefer a conditional analysis procedure that determines which semantics the available evidence
supports.

## Snapshot, version, and rollback

Before changing Agent State, read the top-level `version` from `system_config.yaml`, defaulting to
1 when absent.

Ensure this snapshot exists:

```text
<target>/snapshots/v<version>.tar.gz
```

When the current-version snapshot is absent, package `agent_state/` without `.vault.toml`. Never
overwrite an existing snapshot for the same version.

Use `current + 1` as the candidate version.

Before editing, record the exact original content of every file owned by the round. Write candidate
files through temporary files and validate them before replacing the originals.

If a candidate is rejected or cannot complete a valid comparison:

- restore the files changed by the round;
- remove files created by the round;
- restore the previous version;
- verify the rollback.

If another process changes the Agent State, stop without overwriting its work.

## One-shot feedback mode

Use the user's feedback and any necessary recent Trace to make the smallest targeted change.

After a successful edit, keep the new Agent State, increment the version once, and report the
evidence, change, new version, and reason. If the edit fails, roll back the round.

This mode has no Benchmark comparison, so do not claim a measured score or capability improvement.

## Benchmark optimization mode

Freeze the Case set, Statements, Rubrics, `runs`, and evaluation Model throughout optimization.

A Reference Evaluation must:

- match the current Agent State version;
- use one fixed `(provider, model_id)` pair;
- contain the complete Case × Run matrix.

If the current Agent State has no complete Evaluation, evaluate it without changing State and use
that result as the Reference.

Every Candidate Evaluation must use the same Benchmark, Cases, Runs, Provider, and Model as the
Reference. Use the exact `(provider, model_id)` pair stored by the Reference; do not translate,
alias, or fall back to a different Model identifier.

## Evaluation dispatch

Maintain a Case × Run ledger. Never dispatch a cell that is already pending or valid, and retry a
cell only after an explicit infrastructure failure. Use bounded batches that fit the available
subagent capacity. For independent cells in one batch, launch one `agent-evaluation` subagent per
cell before waiting for any of them to finish, then poll those exact subagent ids until the batch is
complete. Do not wait for one cell to finish before launching the next independent cell.

Prefer an Evaluator response that is one plain protocol YAML document with the fields defined by
`agent-evaluation`. If the response also contains commentary or a code fence, extract one
unambiguous, complete protocol document and ignore all surrounding text. Never use private
Evaluator commentary, Rubric content, Gold answers, or per-item scoring to form an optimization
hypothesis or Agent State edit. If no valid protocol result can be extracted, treat the cell as an
infrastructure failure and retry it according to the ledger; do not terminate the whole
optimization solely because the Evaluator formatted its response incorrectly.

## Optimization loop

For each round:

1. **Analyze the Reference**

   Review the aggregate score, Case scores, and repeated-run stability. Start with representative
   failures, unusual variance, and their Test Traces; expand Trace inspection only when the current
   evidence is insufficient.

2. **State a hypothesis**

   State one falsifiable behavioral hypothesis that identifies the observed failure, the missing
   general capability, and the behavioral change expected from a minimal Agent State edit. Stop if
   no credible hypothesis remains.

3. **Create a Candidate**

   Confirm the current-version snapshot, record the original candidate-owned files, make the
   smallest general edit, and use `current + 1` as the candidate version.

4. **Complete the evaluation**

   Use `agent-evaluation` to complete every Case × Run in the frozen Benchmark. The result is
   comparable only when the Agent State and Benchmark remain unchanged and the matrix is complete
   and valid.

5. **Accept or roll back**

   If the Candidate score is strictly higher than the Reference, keep the Candidate State and
   append its Evaluation to the Scoreboard atomically. If the score is equal, lower, or cannot be
   compared validly, roll back the Candidate and do not write it to the Scoreboard.

Each accepted Candidate becomes the next Reference.

Unless the user asks only for analysis, complete at least one Candidate evaluation before stopping
when infrastructure permits and a credible general edit can be made.

Stop when the user's target or round limit is reached, no credible new hypothesis remains, or
infrastructure prevents a valid comparison. Do not search the score by making random Agent State
changes.

## Final report

Report the score curve from the baseline through every fully evaluated Candidate, including
rejected Candidates. Show it as a compact table and a simple visual curve such as Mermaid
`xychart-beta` or an equivalent text chart. Also report accepted Agent State versions and main
changes, rejected and rolled-back Candidates, Test Session ids, stop reason, and known
limitations.

Distinguish evaluated Agent State from unscored changes. Never attribute a Scoreboard score to an
Agent State that was not evaluated.
