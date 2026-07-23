---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark with repeated independent evaluations and a traceable baseline.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 9
updated: 2026-07-23T15:19:31Z
---

# Benchmark Design

Create and calibrate a multi-Case Benchmark that discovers a specified Test Agent's capability boundary. Own the public Statements, private Rubrics, Case set, configuration, and final baseline. Do not modify the Test Agent State, launch the Test Agent directly, or score a Case yourself.

## Before you start

Require a Test Agent and the capability to measure. If either is missing, ask the user. A Benchmark
run requires a fresh top-level CLI Session with `run_subagent` and `agent-evaluation` installed on
the current Session's Agent. If this Session is already a subagent or the evaluation Skill is
unavailable, stop before creating a partial Benchmark.

Benchmark design is one complete phase. Freeze and record an accepted baseline, return its terminal
result, and stop. Do not invoke `agent-creation` or `agent-optimization`, modify the Test Agent, or
continue another pipeline phase in this Session.

Do not create any persistent phase-role Agent. Benchmark design runs in the current CLI Session,
and every evaluation is a temporary child Session.

## Boundaries

Access only the explicit Test Agent and Benchmark paths. Do not inspect another Agent, Project
configuration files, evaluation-child Workspace, or evaluation-child Trace. The only allowed child
action is dispatching one Case-run protocol request to a fresh child that uses `agent-evaluation`;
consume only its terminal protocol response and returned Test Session id.

Before the first evaluation, do not read the Test Agent's `AGENTS.md`, Skills, Memory, Tools, prior
Traces, or prior Workspaces. Read only `system_config.yaml` for the canonical version and
mechanically compute the supplied State digest without printing State contents. After evaluation,
inspect only the score-linked Test Sessions returned for the current candidate. Do not read a
prior phase Session's Trace, Memory, or Workspace from another workflow.

Use the Environment's Project Dir and the explicit Test Agent id:

```text
PROJECT_DIR = <project_dir>
PROJECT_ID = <basename_of_project_dir>
PENGUIN_HOME = <parent_of_project_dir>
TEST_AGENT_DIR = <project_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <project_dir>/agents/<test_agent_id>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark_dir>/scoreboard.yaml
```

Derive a semantic Benchmark id when the user does not supply one. Require `agent_state/system_config.yaml`; its top-level `version` is the canonical State version and defaults to 1 when absent.
In delegated pipeline mode, also require the creation phase's `expected_state_version` and
`expected_state_digest`; recompute and match both before creating any Benchmark file.

## Benchmark contract

Use this structure:

```text
<benchmark_id>/
├── benchmark_config.toml
├── scoreboard.yaml
└── CASE-<nnn>-<neutral-name>/
    ├── statement/
    │   └── README.md
    └── rubric/
        └── README.md
```

Both README files are required; either directory may contain supporting files. `statement/` is the complete public task and evidence. `rubric/` is private scoring material. Never mention private criteria or paths in the Statement.

Case directory names, titles, headings, and evidence filenames are public evidence. Keep them
neutral whenever the measured capability includes recovering an unstated mechanism, mapping,
precedence rule, state transition, or aggregation rule. They may identify the business setting or
artifact type, but must not name the hidden mechanism or the reasoning operation that earns
points. Audit these labels before every pilot or matrix.

When the requested capability explicitly includes cross-file or multi-source synthesis, each Case
must contain at least two supporting public evidence artifacts in addition to `statement/README.md`.
Each artifact must contribute a fact needed for at least one scored conclusion; decorative splits
and duplicated inline copies do not count. Keep the README focused on the task and output contract
rather than reproducing all evidence in one place.

Create `benchmark_config.toml` first. The Model is deliberately not stored here; each evaluation records the actual `(provider, model_id)` pair.

```toml
title = "<benchmark_title>"
description = "<capability_and_scope>"
runs = 3
```

Use `runs = 3` unless the user explicitly requests another positive integer. Initialize the Scoreboard with:

```yaml
evaluations: []
```

Every accepted evaluation follows scoreboard v2:

```yaml
evaluations:
  - time: "2026-07-17T00:00:00Z"
    version: 1
    provider: <provider>
    model_id: <model_id>
    summary_title: "Calibrated baseline"
    summary: "Abbreviated baseline schema for one Case with three independent runs."
    score: 18
    cost: 0.04
    duration_ms: 60000
    cases:
      - case: CASE-001-example
        score: 18
        cost: 0.04
        duration_ms: 60000
        runs:
          - score: 17
            cost: 0.03
            duration_ms: 58000
            session_id: session-1
          - score: 18
            cost: 0.04
            duration_ms: 60000
            session_id: session-2
          - score: 19
            cost: 0.05
            duration_ms: 62000
            session_id: session-3
```

Case `score`, `cost`, and `duration_ms` are the means of their valid `runs`. Evaluation totals are the sums of the Case means. Omit a Case or evaluation `cost` when any contributing run has unknown cost; never treat unknown as zero. Rubric maxima across the complete Case set must total exactly 100 points before any evaluation is dispatched. Recompute that sum after every material Case or Rubric revision. Never report a raw sum with another denominator as a score out of 100, and do not use post-hoc normalization to make an invalid point scale look compliant.

This Skill writes one final baseline for the current Benchmark definition. A material change to a Statement, Rubric, Case set, or `runs` invalidates prior results: clear `evaluations`, recalibrate, and write a new baseline. Rejected candidates and provisional matrices remain only in the current phase Trace. Evaluation children never write the Scoreboard.

The public `summary_title` and `summary` may describe the tested State, Case-level score patterns, and instability. They must not reveal Rubric or Gold content, expected answers, private scoring reasoning, mappings, thresholds, formulas, or rules.

## Design and calibrate

Before writing Cases, define the observable difference between an Agent that has the requested capability and one that does not. Each Case must make that capability causally necessary, not merely share its topic.

Choose one Benchmark mode before writing any Case:

- **Evidence-grounded** (default): the complete public Statement and evidence uniquely determine
  the answer, although recovering it may require the measured capability.
- **Black-box adaptation** (only when explicitly requested): public evidence determines the answer
  under each member of a finite, precommitted candidate-mechanism set, but does not have to reveal
  which candidate the environment selected. Score feedback across Cases may therefore identify the
  selected convention. The uncertainty may concern only the selected candidate; every candidate
  must itself be executable deterministically from public fields.

Run this counterfactual before accepting a Case: could a competent executor without the target
capability complete it by mechanically following the Statement? If yes, reject or redesign it. A
self-contained Statement specifies the task, available evidence, and required artifact without
disclosing the reasoning, mapping, or rule the capability is supposed to recover. In
evidence-grounded mode the evidence must make the answer uniquely inferable. In black-box
adaptation mode it must make every candidate answer computable and must not require an undeclared
identity rule, state transition, precedence rule, aggregation rule, or output mapping.

For black-box adaptation, create a private machine-readable mechanism manifest before creating
Rubrics or dispatching evaluation. Store it under `<benchmark_dir>/.private/`; never copy or
describe it in a Statement or public Scoreboard summary. It must declare:

- each mechanism dimension and its finite candidate values;
- the selected private value for each dimension;
- the public inputs and deterministic decoder for every candidate;
- any cross-record, cross-object, temporal, or final-output aggregation rule;
- the dimensions exercised by each Case.

Freeze this manifest before the first evaluation. Calibration may revise public data instances,
surface presentation, and Rubrics derived from the manifest after a complete matrix, but it must
not change the candidate set, selected values, public-input decoder, Case-to-dimension binding, or
aggregation semantics. If one of those must change, the Benchmark is a new definition: discard the
calibration history, create a new Benchmark id or explicitly restart from an empty Scoreboard, and
report the semantic restart. Never introduce a hidden rule only after observing a Test answer.

Build several independent, realistic end-to-end Cases with distinct capability-relevant failure modes. Do not manufacture low scores through missing essential evidence, trivia, formatting traps, excessive workload, or unstable infrastructure.

Freeze every Rubric before evaluation. Use atomic observable conditions, exact points, reasonable equivalence rules, and meaningful partial credit. Test the Rubric mentally against full, partial, missing, malformed, wrong-type, and extra output. Never execute Test Agent-produced code while scoring.

Before dispatching any evaluation, run a definition audit over the complete candidate:

- verify that public names and headings do not disclose private mechanism dimensions;
- verify that every required public evidence file is present and materially used;
- verify that every Gold item is derivable under the selected mode and has exactly one Rubric
  disposition;
- recompute all Case maxima and the exact 100-point total;
- check the Statement output contract against the Rubric's expected artifact type and required
  keys;
- reject drafting notes, unresolved alternatives, self-corrections, missing table rows, and
  contradictory rationales from private scoring material.

Do not dispatch a pilot or full matrix until this audit passes.

Use valid evidence to calibrate toward a user-supplied target; otherwise aim near 60/100. Before
the first complete matrix, run one lightweight pilot cell per Case. Pilot cells are screening
evidence only: never write them to the Scoreboard or mix them into a later matrix. Use the pilot to
catch leakage, defective Rubrics, answer-shape mistakes, and an obviously ceiling or floor-heavy
portfolio. Revise the candidate once as needed, rerun the definition audit, and then freeze it for
the complete matrix.

Audit high scores for shortcuts or leakage and low scores for ambiguity, missing evidence,
unrelated difficulty, or a defective Rubric. More items, steps, workload, or ambiguity alone are
not structural refinement. Do not hit the target by merely redistributing Rubric points or
weakening partial credit after seeing model answers; change the capability-relevant evidence,
state interaction, or reasoning path, freeze the revised Rubrics, and run a fresh complete matrix.

A user-supplied score interval remains the calibration target. In a standalone Benchmark request,
accept success only when a complete stable 100-point evaluation lies inside that interval. In a
delegated pipeline, prioritize returning a usable, stable baseline to the next isolated phase:
after the initial complete matrix, allow at most one evidence-backed structural revision and one
fresh complete matrix. If neither stable matrix is in range, freeze the stable valid candidate
closest to the interval, mark `target_met: false`, and return it with
`stop_reason: calibration_budget_exhausted`. This bounded fallback is still a valid measured
baseline, not a claim that the requested range was reached. A caller may explicitly supply a
different positive full-matrix budget.

Score-range fit is necessary but not sufficient. Before accepting an in-range candidate, confirm
that its misses are caused by the intended capability or a consistently chosen candidate
mechanism. Do not treat an extreme correct/incorrect flip across repeated runs as a well-calibrated
mean merely because its arithmetic average falls inside the target interval. Report instability
and redesign when the score depends mainly on unstructured guessing, unless stochastic
decision-making is itself the explicitly measured capability.

Maintain a structural-hypothesis ledger in the current phase Trace. Before each revision, state the
observed shortcut or failure, the capability-relevant change, and the predicted behavioral
difference. A rename, reformat, resampling of equivalent values, or repeat of an already falsified
change is not a new structural hypothesis. When a revision does not move the dominant behavior in
its predicted direction, mark that hypothesis exhausted and do not rerun a cosmetic variant.
Respect the applicable matrix budget and stop rather than searching indefinitely for an exact
aggregate.

## Select the evaluation Model

Use a user-specified `(provider, model_id)` pair when supplied. Otherwise resolve the Project default with the supported CLI, never by reading the hidden Project configuration:

```bash
penguin config model list --project-id "<project_id>" --root "<penguin_home>"
```

The row marked `*` is the default. Keep the same pair through all candidate matrices for this calibration. The pair selects the Test Agent's CLI Session, not the current phase or evaluation-child runtime model.

## Run the Case-run matrix

Read and retain the exact State version, Scoreboard bytes, configured positive `runs`, selected
Model pair, complete valid Case set, and exact bytes of the entire Benchmark definition. For
black-box adaptation this includes `.private/`. Compute a candidate-definition digest and allocate
every unique Case-run cell before dispatch.

Start one child per cell with `run_subagent` and omit `agent_id` so the child reuses the current
Session's Agent and installed Skills. Begin the child request with
`Use the agent-evaluation Skill. Return only its terminal protocol YAML.` Then provide exactly one
protocol request:

```text
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <tested_agent_state_version>
test_agent_id: <test_agent_id>
benchmark_dir: <absolute_benchmark_dir>
provider: <provider>
model_id: <upstream_model_id>
```

Build the complete N × R cell set before dispatch. Run it in deterministic parallel waves of at
most eight evaluation children, allocating every cell identity before the first wave. From the
first dispatch until every allocated cell has terminated, the candidate definition is locked:
do not edit any Statement, evidence, Rubric, private manifest, configuration, or scoring rule, and
do not inspect scores or adapt later requests. If any definition byte changes while cells are
active, terminate or await the remaining children, abandon the entire matrix, and reuse none of
its scores. Continue an active child through `input_subagent`; never duplicate it.

Parse only the last terminal `protocol_version: 1` YAML mapping. Keep every identity-matched
`status: ok` result. Abort the matrix without retry on `invalid_request`, `invalid_statement`,
`invalid_rubric`, `version_changed`, or `invalid_score`. Retry at most once only for a transient
`cli_failed`, `provenance_mismatch`, or malformed/missing terminal protocol, using a fresh
evaluation child and Workspace with the same State, Model, Benchmark, and cell identity. Never
retry a valid scored cell. If any retry remains invalid, abandon the matrix.

An abandoned matrix contributes no cells to a later matrix. If the failure is an owned Statement
delivery or temporary Workspace problem, repair that cause and start a fresh complete matrix. If
the canonical Test Agent path or State is wrong, stop with that blocker. Never move or recreate the
Test Agent, create compatibility symlinks, or weaken provenance checks to make an evaluation run.

For a complete matrix, calculate Case means and evaluation sums using scoreboard v2. Retain every run's score, cost when known, duration, and Test Session id. Re-read State version and exact Scoreboard bytes; abandon the result if either changed.

Use each returned Test Session id to inspect the exact Test Trace and artifact. Analyze all
repeated runs; disagreement is capability instability, not permission to select a convenient
result. Accept a candidate only when the capability caused the scored difference, every applicable
mode contract remained valid, the repeated-run pattern was interpretable, the Rubric was sound,
and useful headroom remains. Check validity before checking whether the aggregate lies in the
target interval.

When an acceptable complete valid matrix is reached, write the final baseline to a temporary
sibling, parse it as YAML, then atomically rename it over `scoreboard.yaml`. Include the sorted Case
set and sorted runs, a real UTC ISO-8601 time, the tested version and Model pair, and a privacy-safe
summary. In a delegated pipeline, the bounded closest stable fallback is also written as the one
final baseline, with its out-of-range status stated in the terminal protocol and public summary.
Rejected candidates remain only in current-phase or evaluation-child Traces. If no complete stable
valid matrix exists, report `calibration_failed`, leave a new Benchmark's `evaluations` empty, and
stop.

Report the Benchmark path, aggregate and Case scores, Test Session ids, refinements, stop reason, and limitations.

## Delegated phase protocol

When the request contains `pipeline_protocol: 1`, work non-interactively and make the final
assistant message exactly one plain YAML document. Emit no code fence or prose around it. Echo the
supplied `workflow_id`; never invent or alter it.

Before returning, compute:

- `tested_state_digest`: SHA-256 over sorted relative paths and bytes of regular files under the
  tested `agent_state/`, excluding `.vault.toml`;
- `benchmark_definition_digest`: the same deterministic digest over `benchmark_config.toml` and
  every Case `statement/` and `rubric/` file plus every regular file under optional `.private/`,
  excluding `scoreboard.yaml`;
- `scoreboard_digest`: SHA-256 of the final `scoreboard.yaml` bytes.

For either directory digest, hash the deterministic sequence of relative path, NUL, raw bytes, NUL.
Reconfirm that the Test Agent version and State digest did not change during calibration.
Use SHA-256 only. Select the implementation with `command -v sha256sum` and otherwise use
`shasum -a 256`; every checksum invocation must include `--` where supported and an explicit file
operand, or consume a finite explicitly produced byte stream. Never invoke `md5`, `md5sum`,
`sha256sum`, `shasum`, or `openssl dgst` without an operand or finite pipeline, because such a call
may wait indefinitely for standard input.
Never probe a checksum command by running it without an operand.

On success:

```text
pipeline_protocol: 1
workflow_id: <workflow_id>
project_id: <project_id>
phase: benchmark
status: calibrated
target_met: <true_if_inside_requested_interval_else_false>
test_agent_id: <test_agent_id>
tested_state_version: <version>
tested_state_digest: <sha256>
benchmark_id: <benchmark_id>
benchmark_dir: <absolute_canonical_benchmark_dir>
benchmark_definition_digest: <sha256>
scoreboard_digest: <sha256>
reference_time: <scoreboard_evaluation_time>
provider: <provider>
model_id: <model_id>
score: <raw_0_to_100_score>
case_count: <positive_integer>
case_ids: [<sorted_unique_case_id>, ...]
runs_per_case: <positive_integer>
expected_cell_count: <case_count_times_runs_per_case>
valid_cell_count: <same_as_expected_cell_count>
reference_evaluation_key: <time_version_provider_model_tuple>
stop_reason: <target_reached_or_calibration_budget_exhausted>
protocol_end: true
```

Return `status: calibration_failed` only when no complete stable valid matrix exists, with the same
identity, version, Model, count, and digest fields when available plus a stable failure code. For
an invalid request or infrastructure blocker, return `status: blocked` with `workflow_id`,
`project_id`, `phase`, available identity fields, a stable `failure_code`, and
`protocol_end: true`. Never return `calibrated` for an incomplete matrix, changed State, invalid
Scoreboard, or a score whose out-of-range status is concealed.
