---
name: agent-optimization
description: Improve an Agent State from direct feedback or versioned multi-Case Benchmark scores and score-linked Traces.
short_description: Improve an Agent from feedback or measured Benchmark results.
short_description_zh: 根据反馈或 Benchmark 结果改进 Agent。
version: 6
updated: 2026-07-23T10:00:25Z
---

# Agent Optimization

Improve an existing Agent State. Use one-shot feedback mode for a direct correction, or Benchmark optimization mode for a measured loop. Do not mix their execution paths. One-shot mode does not require Agent Evaluator. Benchmark mode evaluates every configured Case run through Agent Evaluator and never launches or scores the Test Agent directly.

## Before you start

If the request supplies neither concrete feedback nor an explicit Test Agent and Benchmark, ask what to improve. Determine the mode before editing anything.

Benchmark mode requires a fresh top-level Session with `run_subagent`, a complete baseline series
in `scoreboard.yaml`, and a separately provisioned `agent_evaluator` Agent. If any requirement is
missing, stop before editing State. Do not use Agent Optimizer itself as an Evaluator.

Optimization is one complete phase. Consume only the explicit target, frozen Benchmark reference,
and score-linked public evidence supplied to this phase. Do not create an Agent, design or refine a
Benchmark, or invoke another pipeline phase. Do not read Agent Optimizer's prior Trace, Memory, or
Workspace from another workflow.

## Pick the target Agent

A one-shot request normally names the target. A delegated request begins with `Caller agent: <agent_id>`, and an @-mention handoff contains `<handoff_from>`. When one-shot mode has no explicit target, use that caller or origin; if neither exists, ask. Benchmark mode always requires an explicit Test Agent and Benchmark.

Resolve paths from the Environment's Project Dir without recursively discovering the Project:

```text
PROJECT_DIR = <project_dir>
PROJECT_ID = <basename_of_project_dir>
PENGUIN_HOME = <parent_of_project_dir>
TARGET = <project_dir>/agents/<test_agent_id>
STATE = <target>/agent_state
TRACES = <target>/traces
BENCHMARK = <target>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark>/scoreboard.yaml
```

Never read a Project configuration file, credential, vault, private Rubric, Agent Evaluator State, Evaluator Workspace, or Evaluator Trace.

## State editing policy

Make the smallest complete edit supported by evidence and preserve unrelated instructions and files.

- Behavioral, workflow, role, or domain guidance belongs in `agent_state/AGENTS.md` unless a relevant target-owned Skill already owns that reusable capability.
- Update a relevant target-owned `SKILL.md` when the behavior is a reusable capability shared across tasks.
- Create a narrowly named Skill only when the capability is reusable and no suitable Skill exists. Installing its directory is sufficient; do not register Skill metadata in AGENTS.md.
- Runtime limits belong in safe `system_config.yaml` fields. Do not edit `system_prompt` unless the user explicitly asks.
- Never modify a library-provided Skill such as `penguin-sdk` to carry target-specific behavior.

Every edit must generalize beyond the observed run. Do not encode Case ids, exact expected outputs, Benchmark-specific constants, private criteria, or a guessed answer. Keep a recovered mapping, threshold, or formula only when repeated public evidence supports it as a durable rule; otherwise encode the reasoning and validation method.

## Version and rollback discipline

Before changing Agent State, read its canonical top-level `version` from `system_config.yaml`,
defaulting to 1. Choose exactly one rollback mode before the first candidate:

- **System snapshot mode**: for any Agent that existed before the current top-level Session,
  require `<target>/snapshots/v<version>.tar.gz`. The system owns these archives through Web export
  and import; never create, import, extract, or replace one yourself. If it is missing, stop and ask
  the user to export the current State.
- **Orchestrated bootstrap mode**: allowed for a target created in an earlier isolated phase of the
  same delegated pipeline only when the request supplies one `workflow_id`,
  `target_was_absent: true`, `creator_state_version`, `creator_state_digest`,
  `reference_version`, `reference_state_digest`, `benchmark_definition_digest`,
  `scoreboard_digest`, `reference_time`, `reference_provider`, `reference_model_id`,
  `reference_score`, `reference_evaluation_key`, `case_count`, `case_ids`, `runs_per_case`, and
  `expected_cell_count`. Mechanically recompute and match every value before editing. The target
  must still be canonical, versioned, and unchanged. Never infer bootstrap status merely from
  `version: 1`.

If orchestrated provenance cannot be positively established, use System snapshot mode. Never
create or synthesize a snapshot archive.

For each file the edit will change, record its exact original bytes and whether it existed in a temporary directory outside `STATE`. Never include `.vault.toml`, an unrelated State file, or a snapshot archive. Write each candidate file through a temporary sibling, validate it, and rename it into place. Set the State version to `current + 1` exactly once before evaluation.

If the candidate is rejected or a valid comparison cannot complete, restore only those recorded files, remove files created by the candidate, and verify that the prior version and State digest are active. If the active version or a candidate-owned file no longer matches the value written by this round, treat it as a concurrent mutation and stop without overwriting it. If rollback cannot be verified, stop. In System snapshot mode, ask the user to restore the archive through Web import. In Orchestrated bootstrap mode, preserve the temporary exact-byte backup, report its path and the files whose restoration could not be verified, and treat the active State as untrusted; do not claim or continue optimization.

## One-shot feedback mode

Use the user's feedback and relevant recent Trace when available. Turn that evidence into the smallest targeted change:

- behavior, workflow, role, or domain guidance → update AGENTS.md or the relevant target-owned Skill;
- a missing reusable capability → install or update a narrowly scoped Skill;
- a runtime limit → adjust the relevant `system_config.yaml` field.

Require the current-version system snapshot and record the exact originals of files being changed before editing. Increment the version once after the complete edit. If the edit cannot complete, roll back only those files. Report the evidence, changed State surface, new version, and reason. Do not claim measured improvement because this mode has no Benchmark comparison.

## Benchmark optimization mode

Require `benchmark_config.toml` with a positive integer `runs` and a complete baseline evaluation. The baseline Case set, Statements, Rubrics, and run count are frozen for optimization. Each reference or candidate evaluation must include exactly `runs` uniquely numbered runs for every frozen Case. `scoreboard.yaml` is the only writable Benchmark-side ledger; append only complete accepted evaluations atomically.

Use the reference evaluation's `(provider, model_id)` pair unchanged so scores remain comparable. If the user wants a different Model, stop and ask for a new baseline series rather than comparing across Models.

Before any candidate edit, read the canonical top-level State version and select a reference evaluation in the existing `(provider, model_id)` series. The selected reference is valid only when its `version` equals the active State version and its Cases and runs form the complete frozen Case × `runs` matrix. In delegated pipeline mode it must also match the supplied reference time, score, State digest, Benchmark-definition digest, and Scoreboard digest. Never compare a candidate against an older-version, incomplete, changed-definition, or mixed-Model evaluation.

If the active State has no such evaluation, measure it before optimizing: leave State unchanged, run the complete frozen matrix with the existing series' exact `(provider, model_id)` pair, and validate the results under the same rules used for a candidate. Retain the exact Scoreboard bytes and active State version before dispatch; append the completed no-edit reference through a temporary sibling, YAML validation, and atomic rename only if both remain unchanged. This appended evaluation becomes the reference. If any cell remains invalid after the allowed retry, provenance does not match, State or Scoreboard changes, or the atomic append cannot complete, stop before editing Agent State.

You may inspect the complete target `agent_state/`, public Case Statements, the Scoreboard, and all Test traces referenced by the Scoreboard runs. Use only those explicit Case and Session ids. Never read private Rubric or Gold contents. You may mechanically recompute the supplied Benchmark-definition digest without printing or loading private file contents into model context. Never edit the Benchmark definition, Test traces, Project configuration, or another Agent; `scoreboard.yaml` is the sole Benchmark-side write allowed above.

Scoreboard v2 uses this shape:

```yaml
evaluations:
  - time: "2026-07-17T00:00:00Z"
    version: 2
    provider: <provider>
    model_id: <model_id>
    summary_title: "Improved evidence validation"
    summary: "Added a reusable validation step; all Cases improved without new instability."
    score: 24
    cost: 0.04
    duration_ms: 60000
    cases:
      - case: CASE-001-example
        score: 24
        cost: 0.04
        duration_ms: 60000
        runs:
          - score: 23
            cost: 0.03
            duration_ms: 58000
            session_id: session-1
          - score: 24
            cost: 0.04
            duration_ms: 60000
            session_id: session-2
          - score: 25
            cost: 0.05
            duration_ms: 62000
            session_id: session-3
```

Case metrics are the means of valid `runs`; evaluation totals are the sums of Case means. Omit cost when any contributing run has unknown cost. `summary_title` and `summary` may describe public State changes, gains, regressions, and instability, but must not reveal private Rubric or Gold content, expected answers, or private scoring reasoning.

## Optimization loop

For each round:

1. Reconfirm that the reference version equals the active top-level State version and that it contains the complete frozen Case × `runs` matrix. Then analyze its aggregate, Case scores, repeated runs, and every score-linked Test Trace. Use repeated runs to separate stable failure from variation; never select a convenient Trace.
2. State one falsifiable behavioral hypothesis connecting public evidence to a minimal State change. If no credible hypothesis remains, stop.
3. Reconfirm that the selected rollback mode is still valid. In System snapshot mode, confirm the
   current-version archive exists. In Orchestrated bootstrap mode, recompute and match all supplied
   provenance and digest fields. Then record the exact originals of every
   candidate-owned file, make the candidate edit, and set `version` to `current + 1` once.
4. Retain the exact Scoreboard bytes and candidate version. Build the complete Case-run matrix before dispatch.
5. Start one child per cell with `run_subagent` and set `agent_id: "agent_evaluator"` explicitly.
   Never reuse Agent Optimizer as the Evaluator. Send exactly one request:

   ```text
   protocol_version: 1
   case_id: <case_id>
   run: <1_based_run_index>
   expected_version: <candidate_agent_state_version>
   test_agent_id: <test_agent_id>
   benchmark_dir: <absolute_benchmark_dir>
   provider: <reference_provider>
   model_id: <reference_upstream_model_id>
   ```

   Build the complete N × R cell set before dispatch, then run deterministic waves of at most eight
   Evaluators. Do not inspect scores or adapt later requests until every cell terminates. Continue
   an active child through `input_subagent`; never duplicate it.
6. Parse only each child's last terminal `protocol_version: 1` YAML mapping. Keep every
   identity-matched `status: ok` result. Reject and roll back immediately on `invalid_request`,
   `invalid_statement`, `invalid_rubric`, `version_changed`, or `invalid_score`. Retry at most once
   only for a transient `cli_failed`, `provenance_mismatch`, or malformed/missing terminal
   protocol, with a fresh Evaluator and Workspace but identical State, Model, Benchmark, and cell
   identity. Never retry a valid scored cell. If any retry remains invalid, reject the round and
   roll back the candidate files.
7. Compute Case means and evaluation sums. Retain every score, cost when complete, duration, and Test Session id. Re-read State version and exact Scoreboard bytes, and verify that every candidate-owned file still matches the value written by this round. If State changed concurrently, stop without overwriting it. If only the Scoreboard changed, reject the round and roll back the candidate files.
8. Accept only a score strictly higher than the comparable reference evaluation. On improvement, keep the candidate State and append one evaluation through a temporary sibling, YAML validation, and atomic rename. On an equal or lower score, roll back the candidate files and append nothing.

Each accepted round becomes the next reference. Stop when the user's target or round limit is met, no credible evidence-backed hypothesis remains, or infrastructure prevents another valid comparison. Do not mutate State as random search.

When the user supplied a target score, an accepted improvement below that target is an
intermediate result, not successful completion. Unless the user supplied a round limit, keep
testing evidence-backed hypotheses while any credible one remains. Do not report success until a
complete valid retest reaches the target; otherwise report the precise non-success stop reason.

At the end, report the accepted score curve, State versions and changes, rejected hypotheses and rollbacks, Test Session ids, stop reason, and limitations. Distinguish the active tested State from any unscored State; never claim a Scoreboard score applies to a later untested edit.

## Delegated phase protocol

When the request contains `pipeline_protocol: 1`, work non-interactively and make the final
assistant message exactly one plain YAML document. Emit no code fence or prose around it. Echo the
supplied `workflow_id`; never invent or alter it.

On target reached:

```text
pipeline_protocol: 1
workflow_id: <workflow_id>
project_id: <project_id>
phase: optimization
phase_agent_id: agent_optimizer
status: optimized
target_met: true
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
benchmark_definition_digest: <unchanged_sha256>
baseline_version: <version>
baseline_score: <raw_score>
final_version: <active_tested_version>
final_score: <raw_score_at_or_above_target>
target_score: <target>
score_curve: [<baseline>, <accepted_score>, ...]
accepted_changes: [<privacy_safe_generalized_change>, ...]
accepted_rounds: <positive_integer>
invalid_cell_count: 0
final_state_digest: <sha256>
scoreboard_digest: <sha256_after_final_accepted_append>
stop_reason: target_reached
protocol_end: true
```

If credible hypotheses are exhausted before the target, return `status: target_not_reached`,
`target_met: false`, the same identity/digest fields, the tested final version and score, the score
curve, accepted changes, `failure_code: no_credible_hypothesis`, and `protocol_end: true`. For an
invalid request, provenance mismatch, infrastructure blocker, or unverified rollback, return
`status: blocked`, `target_met: false`, `workflow_id`, `project_id`, `phase`, `phase_agent_id`,
available identity/version fields, a stable `failure_code` and `stop_reason`, and
`protocol_end: true`. Never report `optimized` for an untested State, changed Benchmark
definition, incomplete matrix, invalid rollback, or score below target.
