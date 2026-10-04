---
name: agent-evaluation
description: Run one specified Test Agent on one specified Benchmark Case exactly once, privately score that execution, and return one protocol result.
---

# Agent Evaluation

If an applicable reference conflicts with this SKILL.md, follow the reference
because it is more specific. Within its scope, a method or benchmark recipe also
takes precedence over Penguin defaults; user instructions take precedence over
both. Read only applicable references, record overrides, and report any behavior
that Penguin's actual interfaces cannot support.

First distinguish the request: a complete-Benchmark request with `runs` uses the
[matrix controller reference](references/matrix.md). An explicit `protocol_version`
request uses the single-cell rules below; malformed cell fields do not become a
matrix request. The controller delegates, while a cell Evaluator only executes
and scores its assigned attempt.

Evaluate one Case × Run cell. The caller owns the case set, repeats, parallel
`run_subagent` dispatch and result aggregation. Each Evaluator handles one cell
in a separate context, launches the requested Target once, and privately scores
that execution. Do not spawn another Evaluator or write `scoreboard.yaml`.

During the released evaluation task, emit only one plain protocol YAML result.
The companion bootstrap's WAITING acknowledgment is a separate control turn,
not part of the evaluation response. Keep audit reports in their separate channel.
No progress narration, Markdown fences or private scoring details enter the result.

## Companion supervision

Read and follow [Agent Supervision](../agent-supervision/SKILL.md) before work.
Without an assigned pair, act as the delegating Root and start a Supervised Agent
with its Supervisor companion. With a verified pair binding, execute this Skill;
pair each new task child separately. Join both reports at the parent. Confirmed
cheating permits at most three fresh retries with corrective user instructions;
continued cheating on attempt 4 receives a policy zero and reason under that
contract. This caller-owned recovery is separate from unstarted-launch repair.

## Before you start

Read [Penguin](references/penguin.md) for platform paths, launch, Trace binding and
default Rubric scoring. Also read an applicable benchmark recipe:

| Benchmark | Reference |
| --- | --- |
| GDPevo / GDP EVO | [GDPevo](references/gdpevo.md) |

Resolve benchmark identity from its config/provenance or the caller; do not infer
it only from a directory name. Unknown benchmarks use Penguin plus their supplied
Rubric and Runtime instructions. Preparation may be benchmark-specific, but
construction and calibration belong to other Skills.

## Request

Use this Skill for one complete request from its delegating parent, through
`run_subagent` or the explicitly bound companion server-Session transport:

```text
protocol_version: 1
case_id: <case_id>
run: <1_based_run_index>
expected_version: <tested_agent_state_version>
test_agent_id: <test_agent_id>
benchmark_id: <benchmark_id>
provider: <provider>
model_id: <model_id>
```

Require exactly one value per field, positive integer run/version values, and a
complete nonempty provider/model pair. `run` labels one execution, not a repeat
count. Missing, duplicate or conflicting fields return `invalid_request` without
creating a workspace or launching the Target. Do not ask the user to repair a
worker request; the caller handles it. Without a valid request, return the failure
before creating either member of a companion pair.

## Prepare and freeze

Resolve the requested Target, Benchmark and Case from the Environment and recipe.
Use only this cell's authorized inputs, State, runtime and execution evidence.
Reject traversal or escaping paths. Never inspect credentials, other cases,
unrelated traces or workspaces; pass injected authentication without displaying it.

Verify the expected State version and runtime before launch. Snapshot persistent
State and Case materials, excluding secrets. Give the Target a fresh context and
unique workspace containing only public task inputs; keep private Rubric, gold,
scoring code and Evaluator reasoning outside that workspace. Keep each worker's
scratch private and retain its exact paths across calls.
Read-only access includes execution side effects: run graders without writing
caches or logs into frozen Case materials. Use a private execution copy when a
runtime cannot suppress those writes; do not hide them by widening hash exclusions.

Follow the Case's declared Runtime: check prerequisites, prepare and reset or
restore the environment, verify readiness, and bind per-run values only in the
copied task inputs. Preserve frozen Benchmark and State files. Record the prepared
workspace as the launch baseline. Services must survive setup calls and remain
usable through scoring; always clean up this cell's owned resources, including on
failure. Follow declared temporal continuation rather than assuming every task
starts from an empty environment. Missing infrastructure is `evaluation_failed`,
never a silent environment substitution or Target score zero.

## Execute and verify

Prepare a separate companion for the Target, then use the create-before-start
procedure in Agent Supervision's Penguin reference. The ordinary evaluation
recipe still defines Target/model/workspace, thinking and scoring. Include its
allowed task files, public interfaces and scratch scope in the launch instruction.
The Target solves its task without editing persistent harness state or reading
private evaluation material. The Evaluator does not repair the Target's answer.

Retry a failed launch only when workspace and trace evidence proves the Target
never started, and each retry applies a new specific repair. Do not retry an
unchanged launch or a started/completed/aborted Target. Return `evaluation_failed`
if start status is uncertain, no safe repair remains, or external setup is needed.
The caller owns any separately recorded replacement attempt.
For confirmed cheating, return this attempt's failure and let that caller use the
shared retry counter; do not launch a second Target inside this evaluation worker.

After execution, verify unchanged State contents, version and thinking, and
unchanged Case materials. State drift is `version_changed`; changed Case material
is `benchmark_invalid`. Preserve evidence and leave restoration to the caller
once all workers are idle. Bind exactly one execution to this cell through the
recipe's identity checks; missing or ambiguous binding is `evaluation_failed`.

Check actual tool calls and matching outputs against the declared access boundary.
Resolve relative paths using the workspace and shell working directory. A path
mentioned in reasoning or an authored audit pattern is not a read; a clean keyword
search is not proof of compliance. Include unsuccessful file/network operations
when the declared boundary prohibits those attempts. Record what was checked.
A confirmed violation, external abort or unresolved material access question is
`evaluation_failed`, even when an artifact exists or a grader returns a score.
Join the Target companion's final report before deciding. A cheating reason goes
in its private audit record and redacted parent notification, not the raw failure
YAML. The caller applies a terminal policy zero after the retry limit; this worker
never reports that penalty as a grader score. Clean up owned resources and return
your protocol result; the parent then joins your own companion's final audit.
Do not wait for that audit before returning, since it requires your task-end event.

## Declared training phases

A selected method may explicitly request a training-only reflection/regeneration
execution. Its caller supplies phase identity, training case and allowed feedback
in the task instruction alongside the unchanged evaluation request. Stage only
that declared reflection payload for the new Target; never open the Evaluator's
private reasoning to assemble it. Save it in the attempt provenance. It must not
reach a frozen baseline/final or testing execution. Each worker still launches
one Target; the method controller, not this Evaluator, owns the training sequence.
Classify these results as assisted training diagnostics, not benchmark test scores.

## Score the saved execution

Use only this cell's artifact, bound execution and authorized scoring materials.
Apply the declared Rubric or source grader without modifying either. Pass explicit
artifact paths, preserve raw grader output and follow its score conversion and
failure policy. Ordinary wrong, malformed or missing answers are scored behavior
when the declared policy applies; infrastructure, binding and grading failures
are not zeros. Keep gold, per-item feedback and scoring rationale private.

Return a finite score on `0..100`, rounded to two decimals. Keep recorded cost
precision or return null when unknown; missing cost does not invalidate a score.
Return duration as a nonnegative integer in milliseconds. Record actual runtime
identity using the recipe, not assumptions about Project defaults.

## Return

Resolve feedback visibility from the caller's role and declared phase, not the
method name alone. A score-blind training Optimizer differs from an independent
test Reporter authorized to receive scores. Follow any explicit routing contract
without changing the saved grader result; never send testing feedback to training.

Return the required YAML as the only worker-authored text. Do not wrap it in backticks or a Markdown fence.

If the caller reports that your response formatting was invalid, use the scored or failed result already present in this Session and resend only the clean protocol YAML. Do not call tools, relaunch the Test Agent, rescore, or add an explanation.

For a scored result:

```text
protocol_version: 1
status: ok
case_id: <case_id>
run: <run>
agent_id: <test_agent_id>
expected_version: <version>
provider: <actual_provider>
model_id: <actual_model_id>
thinking_level: <configured_thinking_level>
score: <0_to_100>
cost: <number_or_null>
duration_ms: <non_negative_integer>
session_id: <test_session_id>
```

For an evaluation failure, use `null` for an identity field that was missing or conflicting:

```text
protocol_version: 1
status: failed
case_id: <case_id_or_null>
run: <run_or_null>
agent_id: <test_agent_id_or_null>
expected_version: <version_or_null>
provider: <provider_or_null>
model_id: <model_id_or_null>
thinking_level: <thinking_level_or_null>
failure_code: <stable_failure_code>
```

Use four failure codes:

- `invalid_request`: the request is incomplete or inconsistent.
- `benchmark_invalid`: the Statement, Rubric, or scoring contract is invalid.
- `version_changed`: the Test Agent version does not match the request, or persistent State changed during evaluation.
- `evaluation_failed`: launch could not be safely repaired, or Trace binding or scoring failed.

Never include score, cost, duration, Session id, private data, or optimization advice on failure.
