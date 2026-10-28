# Recorded execution

For new experiments, use the isolated executor in [executor.md](executor.md). This reference
specifies the journal schema and algorithmic transitions that executor uses internally.
`scripts/experiment.py` remains the artifact/state validator; it does not launch or confine
roles by itself. An `isolated-v1` journal accepts mutations only through `executor.py`.
Legacy journals keep their recorded execution mode and are never migrated automatically.

## Initialize and resume

Write a JSON configuration outside the journal, then run:

```bash
python3 "<skill_dir>/scripts/executor.py" init "<OUT>" "<config.json>"
```

Configuration (add the required `execution_mode` and `executor` fields from `executor.md`):

```json
{
  "experiment_version": "<fixed experiment version>",
  "reporting_metric": { "name": "benchmark_score", "definition": "<public native metric definition>" },
  "test_agent_id": "target",
  "benchmark_id": "construction-benchmark",
  "case_ids": ["CASE-001"],
  "test_benchmark_id": null,
  "test_case_ids": [],
  "runs": 3,
  "include_baseline": true,
  "include_reader_control": false,
  "max_refinement_retries": 3,
  "max_targeted_searches": 3,
  "max_virtual_tests": 60,
  "feedback_policy": "bounded-evidence-v1",
  "construction_timeout_minutes": 360,
  "practice_prefixes": [],
  "runtime": {
    "construction": { "provider": "provider", "model_id": "model", "thinking_level": "medium" },
    "target": { "provider": "provider", "model_id": "model", "thinking_level": "medium" }
  }
}
```

Replace every example identity with the actual value. Also record `method`, paper URL,
pinned source revision, installed Skill version/hash, baseline State version/hash,
environment versions, isolation actually enforced, additional budgets and declared
adaptations as configuration fields. `practice_prefixes` lists this experiment's container
mount roots; the helper also rejects `/opt/openskill-skills` and OUT paths in deployable text.
Record `component_versions` and the resource ledger as `result-records.md` specifies. The
experiment version is fixed at initialization; it is not regenerated for each test repeat.

The executor preflights all construction images before journal initialization; see
`executor.md` for GDPevo startup configuration and the standalone `preflight` command.
Preflight is infrastructure validation, with no practice, verification attempt or model call.
After `start-case`, every role's startup time remains part of that Case's existing deadline.

With `test_benchmark_id`, use a distinct published Benchmark and declare its Case ids from
metadata only. Do not read its statements, inputs, rubric or traces during construction.
Only construction Cases reach creators and verifiers. The final evaluation plan targets
the test set; it does not additionally score the training set. Without this parameter,
the original same-task protocol remains the default. Report the split as an adaptation,
and report any known overlap; benchmark names alone do not prove a clean split.

The journal is authoritative for execution state. Each command publishes a new, atomically
written `journal/NNNNNN.json` containing the request, UTC time, previous-record hash and
resulting state. Old records are never replaced. Read it after compaction or interruption:

```bash
python3 "<skill_dir>/scripts/experiment.py" status "<OUT>"
python3 "<skill_dir>/scripts/experiment.py" next "<OUT>"
```

`status` and `next` are read-only. `next` derives the next allowed work from recorded evidence,
including each Case's UTC deadline, remaining seconds, verification/search budgets and separate
practice/skill-change/valid-measurement counts. It neither dispatches a role nor proves that
the role followed the instruction. Read it before dispatch and while waiting; do not estimate
elapsed time from conversation length. A pending attempt near its deadline is still pending,
not already timed out. At zero remaining seconds, stop its worker and collect what actually ran.

Resume the recorded creator, attempts and phase; never reset counters or recreate the
experiment to continue a spent budget. A pending attempt must be inspected and completed
from its actual evidence before another begins. A missing creator cannot be replaced with
a fresh session and called the same run: preserve available artifacts and record interruption.
Do not remove a stale `.journal.lock` until its writer is known to have stopped.

This Skill version creates schema-2 journals only for new experiments. `status` can read a
schema-1 journal, but this version refuses to append events or derive `next` actions for it.
Resume that run with its recorded Skill version and helpers. Nothing converts previous
`experiment.yaml` runs, journals, installed libraries, snapshots or scores; do not initialize
a new journal over them or retroactively mark their failed measurements valid.

## Record construction

Write each request as a JSON file, and issue it with:

```bash
python3 "<skill_dir>/scripts/executor.py" event "<OUT>" "<request.json>"
```

All Case events include `case_id`. The table describes the underlying event schema. For
isolated runs, `plan`, `revision`, `begin-verification` and `finish-verification` are private
executor transitions: invoke `creator`/`verifier`, never submit these four events manually.
`record-verification-plan` and `record-verification-review` are also executor-owned; use
`verifier-plan` and reviewed `verifier` dispatch. A pending plan awaits controller review,
not another `begin-verification`. Other events use `executor.py event`. Actions follow:

| Action | Additional fields | When |
| --- | --- | --- |
| `start-case` | none | Before this Case's research; starts its wall clock |
| `plan` | `skills`: fixed list of 1–4 names; `creator_session_id` | After research/planning and creation of its persistent creator |
| `revision` | `creator_session_id`, `hypothesis`, `execution_record`: OUT-relative receipt path | After initial practice or the recorded recovery action and practice execution |
| `begin-verification` | optional existing `verifier_session_id` | Before dispatching any pytest attempt, including verifier repairs |
| `finish-verification` | `execution_status`, `pytest_exit_code` if completed, `verifier_session_id` | After that attempt stops, even if it failed to generate a report |
| `feedback` | `attempt`, `issues`, `classification`, `next_action`, `diagnosis`, `expected_change`, `evidence` | After unsuccessful verification, before any further repair/search |
| `targeted-search` | `classification: NEEDS-DR`, sanitized `query` | Before issuing each gap search; failed requests also spend budget |
| `search-result` | `search`: 1-based reservation index, `outcome`, `summary`, `sources` if retrieved, `evidence` | After an issued gap search finishes, before continuing recovery |
| `research-fallback` | `attempt`, `reason`, `unresolved`, `planned_change`, `validation`, `evidence` | Once per Case under bounded evidence, after unavailable research or search-cap exhaustion; only for skill revision |
| `finish-case` | `reason`; `record`: OUT-relative stop record except for `surrogate_pass`, `max_refinement_retries`, `time_budget` | When creator/verifier writes have stopped |

New isolated runs default to `feedback_policy: bounded-evidence-v1`; the explicit value
`strict` preserves earlier behavior. See [bounded-feedback.md](bounded-feedback.md) for
the fallback record, evidence-backed `skill_findings` and `evidence_limited` closure.
The latter retains `accepted: false`, the full coverage map and final issues while allowing
valid skills into the normal global freeze. It cannot hide failed/missing supported checks.
Existing journals without this field are not reinterpreted or modified.

The live skills are `OUT/tasks/<case_id>/skills/<name>/`. Put each practice execution's
outputs in a new `practice/revision-N/`, starting at 0; do not edit earlier outputs. A
`revision` hashes the skills and outputs and preserves an immutable skill copy under
`revisions/revision-N/`. For subsequent revisions, `hypothesis` connects the failed assertion
and independent evidence to the intended change and expected behavior. The helper verifies
that revisions come from the same creator and follow recorded virtual feedback, not target scores.

The executor saves an execution receipt under this Case, outside its sealed practice directories.
This is the stored format, not a request for the model to manufacture a receipt:

```json
{
  "creator_session_id": "actual creator id",
  "skills_sha256": "actual digest of the executed skills tree",
  "output_directory": "tasks/CASE-001/practice/revision-0",
  "commands": ["actual executed command with arguments"],
  "exit_code": 0,
  "started_at": "2026-10-16T10:00:00+00:00",
  "finished_at": "2026-10-16T10:00:02+00:00",
  "evidence": ["tasks/CASE-001/executions/run-0.log"]
}
```

Use actual values and a separate receipt/log for each execution. Compute the digest with
the shipped `artifacts.py` functions: `digest(tree(Path("<case>/skills")))`; import them from
the Skill's scripts directory. Save raw tool/process output, including failed execution.
For a revised practice run, timestamps must follow its feedback; all practice execution must
finish by the Case deadline. Collection may happen later if the execution already completed
in time. The validator checks identities, hashes and timestamp ordering. For isolated runs, the
executor obtains these values from its subprocesses and SDK streams. Traces still need
review to establish how the creator applied its skills; execution alone does not prove use.

All `evidence` lists contain nonempty regular files inside OUT, using relative paths. The
helper seals their bytes and checks them again at freeze. Use immutable copies of retrievals,
diagnoses, receipts and raw logs; do not cite a mutable `knowledge.md` as sealed evidence.

`begin-verification` reserves the attempt and spends budget before execution. Its returned
directory is `verify/attempt-N/`, starting at 1. Create it and save `suite.py`, `report.xml`,
`coverage.json`, raw logs and diagnosis there. Never overwrite a prior attempt, rerun pytest
inside an attempt, or omit an attempt because only the verifier changed. Use `execution_status:
completed` only when pytest actually finished, with its integer exit code. Use `interrupted`
for an unfinished process or `not_started` when pytest never ran; omit `pytest_exit_code` or
set it to null in those two cases. They remain unscored even if an XML file exists. If the
verifier failed to launch, record the dispatch failure identifier as `verifier_session_id`
and explain it in the diagnosis. Finish the attempt before recording feedback elsewhere;
never append diagnosis to an already sealed attempt directory.

The helper invokes the existing JUnit parser, records evidence hashes and checks requirement
coverage and skill structure. Coverage is a verifier-authored list, grounded in public inputs:

```json
[
  {
    "requirement": "Numeric totals retain required precision",
    "requirement_id": "precision",
    "expectation_sha256": "<copied from the host's coverage-template.json>",
    "required": true,
    "source": "public instruction section and independent computation/reference",
    "status": "covered",
    "tests": ["suite::test_precision"]
  }
]
```

Test ids are the JUnit `classname` plus `::` plus `name`, including parameter suffixes.
In reviewed plans, requirement identity is `requirement_id`. Repeated wording across
different tasks is permitted; duplicate IDs, omitted rows and changed bindings are errors.
Every mapped test ID must occur in the actual JUnit report. A nonexistent test is a protocol
error; an executed failing test leaves coverage incomplete and retains its assertion failure.
Unresolved requirements use `status: unverified`; keep their required flag true. A required
entry needs a source and passing, executed assertions. Missing, malformed or incomplete
coverage prevents `surrogate_pass` even when the numeric pass rate is 1. This checks the
declared mapping, not whether the verifier identified every requirement or chose correct
expected values. New isolated runs first enforce the independently reviewed plan described
in `executor.md`; unsupported entries cannot be promoted or removed. This still does not
prove semantic entailment or the correctness of arbitrary generated test code.

## Feedback and recovery

After an unsuccessful attempt, use `next`'s `latest_issues` and examine the underlying evidence.
The `feedback` event must address every reported issue. For example:

```json
{
  "action": "feedback",
  "case_id": "CASE-001",
  "attempt": 1,
  "issues": ["assertion_failure", "coverage_gap"],
  "classification": "SELF-FIXABLE",
  "next_action": "revise_skill",
  "diagnosis": "The aggregation script omits negative adjustment rows",
  "expected_change": "Regenerated totals include the adjustments using the documented rule",
  "evidence": ["tasks/CASE-001/diagnoses/attempt-1.json"]
}
```

An issue list is evidence-dependent: a failed required assertion also leaves its requirement
uncovered. A missing/invalid measurement or coverage protocol yields `verifier_error`;
an honestly unverified requirement yields `coverage_gap` without a protocol error. A valid
measurement is retained even when its coverage protocol is invalid. Missing coverage cannot
be treated as evidence of correctness. Keep assertion details, public sources and specific
file/procedure changes in the diagnosis file. Feedback is sealed for its attempt.

| Recovery action | Required work before the next verification |
| --- | --- |
| `revise_skill` | Same creator edits reusable skill content, re-executes practice, records a new `revision`; skill digest must change |
| `repeat_practice` | Record a concrete `execution_issue`, correct that execution/delivery fault, re-execute and record a new `revision`; skill digest must stay unchanged |
| `repair_verifier` | Prepare an independently justified verifier correction and reserve a new attempt against the current practice output; no new practice revision |
| `finish_evidence_limited` | All supported checks pass; retain unknown rules and complete process review before bounded-evidence closure |

A structural skill fault requires `revise_skill`. To choose `repair_verifier` when assertions
failed, include `oracle_correction` explaining the independent evidence that the previous
expectation was wrong. This field and its cited evidence support review; a string cannot
prove the semantic correctness of the replacement oracle. Do not remove failing assertions
or relax tolerances merely to pass. Missing supported checks need verifier work; unknown rules
can remain in an evidence-limited closure. With bounded evidence, a coverage-only skill repair
requires `skill_findings` describing an observed defect, planned change, validation and sealed
evidence. Byte changes label a recorded revision, not demonstrated improvement.

`NEEDS-DR` requests targeted research before repair. Reserve every search, then
record `search-result` with `outcome: retrieved` and source URLs, or `outcome: unavailable`
and the failure. Both need a summary and raw evidence. All issued requests for that feedback
must be collected. Under `strict`, at least one must supply relevant evidence. Bounded evidence
permits one recorded skill-repair fallback after unavailable research or search-cap exhaustion;
it does not require burning all searches before addressing a known bug. A reservation or empty
reply cannot substitute for knowledge. Reconcile the evidence with the diagnosed gap and retain
unresolved rules. Failed searches still spend budget. Evidence-limited closure is not a repair
and does not require another search after supported checks already pass.
Results can be collected after expiry, but no new search or repair may start then.

With the default retry limit, reserve at most three verifications and execute at most four
practice revisions. The edit after the third failure can still be exported without a fourth
verification. A final failed attempt still needs feedback. If its action is skill/practice
repair, perform that last revision before `max_refinement_retries`; a verifier-only repair
stops at the cap without an extra call. If time expires first, use `time_budget`. No best-of-N
selection, extra final verification or rollback is introduced.

## Stop evidence and tested status

Termination reasons are `surrogate_pass`, `max_refinement_retries`, `time_budget`,
`context_budget`, `verifier_failure`, `environment_failure`, `contaminated`, `interrupted`,
`construction_failed` or, under bounded evidence, `evidence_limited`. A deployable result needs valid final skills, even after a budget
or verifier stop. A contaminated Case or a missing/invalid skill set blocks global deployment.
Do not label a timeout or unresolved requirement as success. `time_budget` requires the actual
deadline to have passed. Except for success, retry-cap and wall-time stops, supply a stop `record`:

```json
{
  "reason": "environment_failure",
  "cause": "The required runtime cannot start; the documented fallback is unavailable",
  "workers_stopped": true,
  "recoverable": false,
  "recovery_attempts": ["Describe the bounded recovery actually attempted"],
  "evidence": ["tasks/CASE-001/termination/runtime-error.log"]
}
```

The receipt and cited raw evidence are sealed. Environment/verifier stops require
`recoverable: false` and actual `recovery_attempts`, or `why_recovery_impossible` when no
recovery can be attempted. A failed assertion alone is not an unavailable verifier; a verifier
stop must follow a recorded `repair_verifier` diagnosis. `context_budget` needs observed
integer `context_used` / `context_limit` at or above 90%. `interrupted` needs `interruption:
user_stop`, `creator_unavailable` or `host_interruption`, with the corresponding evidence.
Low remaining time, a busy queue or a preferred scheduling cutoff is not an external interruption.
Use `construction_failed` for unusable final skills, and `contaminated` for forbidden exposure;
both block deployment and still require cause, stopped workers and evidence. These records
cannot establish the truth of a claimed blocker; the controller must corroborate it from traces.

`last_tested_sha256` and `last_valid_verification_attempt` refer to the last completed, parsed
virtual measurement with a saved suite, even if its assertions failed. `final_was_tested`
requires a valid measurement of the final practice execution and matching skill bytes; it
does not mean success or complete coverage. Merely reserving an attempt, leaving a report
after interruption, or re-executing identical skills does not make a new practice execution
tested. `final_verification_issues` preserves the latest attempt's problems, or `not_run`
for an unverified final execution. An earlier valid measurement is retained separately when
a later verifier fails; do not carry its pass rate forward as that later attempt's result.

## Freeze and measure

Assemble the library from the last registered revisions, including their `contract.json`
files, as `initialization.md` specifies. Finish every Case, stop all writers, then submit
`{"action": "freeze"}`. It verifies the planned contents, portable resources, historical
evidence and final hashes. Save the command's complete JSON response outside the library as
`OUT/freeze.json`; its `library` field is the manifest. Require exit code 0 and `phase: frozen`
before deployment. Content fixes must happen before the last revision is recorded and the
Case is closed; do not repair skills after freezing or substitute an older passing version.

Snapshot baseline and final State as usual. Submit `begin-evaluation` with the actual
`states` mapping, each entry holding `version` and `sha256`:

```json
{
  "action": "begin-evaluation",
  "states": {
    "baseline": { "version": 1, "sha256": "actual full State digest" },
    "final": { "version": 2, "sha256": "actual full State digest" }
  }
}
```

Follow the returned `evaluation_plan` and `evaluation.md` for every cell. The
helper never reads the Benchmark or launches a scored run. The controller still verifies
live State digests before and after each matrix and publishes complete matrices to the
proper Benchmark's scoreboard. Construction remains closed even if evaluation fails.

Keep worker protocol results as JSON under OUT, grouped as
`[{"variant": "baseline", "benchmark_id": "...", "cells": [<worker result>, ...]}, ...]`.
Submit `finish-evaluation` with `outcome: complete` and `record: <relative JSON path>` only
after scoreboard publication. The helper checks the exact planned cells, versions and
runtime; it does not recompute scoreboard averages. On an unfinished evaluation, use
`outcome: incomplete` and a report path instead. Preserve partial evidence and report which
matrices were published, without inventing an aggregate for missing cells.

`runs` counts complete test repetitions of the same frozen State, not construction reruns.
The default is three; explicit counts and existing journals retain their recorded value.
Use `evaluation_results.py report` before publication to calculate native scoreboard records,
per-repetition scores and sample standard deviations from these same matrices. Both helpers
share the complete-cell validator, including protocol, nullable cost, duration and unique
trial identities. Follow `experiment-organization.md` for multiple Benchmark units and totals.

`include_reader_control` is an optional ablation, false by default. Declare its extra
`test Cases × runs` cost before construction. Prepare a separate State with the final
reader mechanism and an empty library/index, preserving baseline configuration and all
unrelated content. Snapshot it as `reader_control` and record that State in
`begin-evaluation`. Measure it only after the final library freezes. It supplements the
original baseline, never selects skills and never supplies construction feedback.
