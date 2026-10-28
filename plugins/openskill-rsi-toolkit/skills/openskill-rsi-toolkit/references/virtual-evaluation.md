# Virtual evaluation during construction

This protocol implements the practice loop in OpenSkill §2.2.2 and Appendix B. It never calls the shared `evaluation.md` protocol, reads a target rubric or writes the Evaluation Center's scoreboard. All roles operate on one Case's staged public inputs and independently retrieved knowledge. Target evaluation begins only after all Cases are frozen.

## Creator

The controller invokes `executor.py creator`. The executor retains the actual dedicated creator Agent and SDK Session identity and records the fixed construction runtime. A creator receives:

```text
Role: OpenSkill creator. Work only in the assigned practice directories.
Public instruction and allowed input manifest: <paths>
Domain knowledge and skill plan: <paths>
Reusable skill destination: <scratch path>
Practice environment and output destination: <paths and launch instructions>

Draft all planned skills together. Each SKILL.md needs a matching name,
description and dated version. Follow the supplied skill-contract.md: describe
applicability, parameters, output contracts, checks and limitations; include a
contract.json with a stable id and every resource. Put reusable code in scripts/
and cite references. Resolve resources relative to the skill, not a practice root.
Draft skills in the authoring turn. When the executor resumes you for practice,
read and apply the frozen skills to the allowed inputs. Generate outputs by
running the procedures; do not embed this task's answer in a Skill.
The conversation persists, but author scratch does not transfer. Read the
executor's read-only inputs/practice-context.json for the current file inventory.
Do not depend on deployment reports or outputs remembered from authoring.
The executor performs the skill/input integrity checks before and after practice.
Return output paths and limitations. The executor records actual tool/process
execution, hashes and timestamps; do not manufacture an execution receipt.
Do not read target scores, tests, rubrics, solutions, old traces or other Cases.
Do not spawn subagents or change the Target Agent State. Await controller feedback
before making another revision.
```

The actual task input is permitted during practice, as in the source. "Virtual" describes the independently generated verifier and its supervision, not a requirement to invent unrelated user tasks. Small synthetic inputs and documented examples can add checks when they exercise the same skills. Keep these checks grounded and record that coverage.

Before the initial practice, include a small number of relevant documented-interface probes
in the output allowlist when the task permits them. Capture actual frozen-skill invocations,
inputs, exit status and outputs. For example, exercise both advertised JSON input forms
rather than inferring their correctness from a successful default invocation. The independent
verifier derives expected behavior from public contracts and checks these recorded outputs;
the creator's own pass/fail assertion supplies no independent acceptance.

On each revision, invoke `executor.py creator` again; it resumes the same recorded SDK Session. Supply the recorded feedback, structured virtual failures and any gap research. Keep the planned skill count fixed. The creator fixes skills/scripts and re-executes in a clean output directory or restores the input environment first. The executor imports outputs into `practice/revision-N/` and registers `revision` with a measured execution receipt as `execution.md` describes. The helper preserves each skill revision and hashes its outputs before another attempt. Outputs must come from the recorded skill revision; stale files cannot satisfy a later test. State the proposed correction and observable behavior expected from it, then check that prediction in the next allowed verification. Skill repair must change reusable content. An execution/delivery repair with unchanged skills is `repeat_practice` and counts only as another practice execution.

## Independent verifier

The controller invokes `executor.py verifier-plan`; it creates a fresh dedicated verifier
Agent/Session in its own container. It proposes expectations before seeing candidate outputs.
The controller reviews each claim against its cited independent evidence, then invokes
`executor.py verifier` with the review to continue that same attempt and Session. This
planning/review stage is a Penguin execution adaptation, not an additional paper retry.
The context available across the two stages contains only:

- the task instruction and allowlisted environment inputs;
- verification anchors with source citations;
- output artifacts from this practice execution, after plan review;
- its own previous test script and failure list, if a suite needs refinement.

Do not give it creator prompts, conversation, private reasoning, skill scripts or implementation code. It may inspect code when the requested deliverable itself is source code, but not the creator's reusable implementation of that deliverable; record that distinction. Never pass GT paths or even a GT pass/fail bit. Its separate Session does not inherit the creator's conversation. Tell it not to browse parent directories, consult other traces or use target scoring files.

Ask the verifier to:

1. Map each public requirement to independently checkable subclaims in `verification-plan.json`.
   Separate supported computations/record joins from unknown policy, retaining the latter as
   explicit requirements. Do not let one unknown item hide supported checks in a large vector.
   Cite exact public excerpts and describe the derivation; label missing rules as hypotheses.
   An enum or an observation alone cannot establish an assignment or threshold. The controller
   reviews the plan before authoring proceeds. Matching an excerpt proves only source membership.
   Use the plan/review schema in `executor.md`; never infer correctness from the current output.
2. Write a pytest suite with at most 60 collected test cases, including parameterized instances. Prefer equality on exact values; numeric tolerances must follow the documented contract. Test content as well as shape. At least 60% of tests should read and validate actual outputs, following the upstream verifier prompt. Every check needs a requirement/source mapping. No live LLM judgments, unseeded randomness or web lookups inside tests.
3. Use assertion failures for incorrect/missing target outputs. Test setup, import, collection and execution errors are verifier failures, not low skill scores. Do not mark required checks skipped, xfailed or deselected to reach a pass.
4. Submit the suite to the executor. It runs pytest once in a fresh measurement container and saves the raw log and JUnit XML report. Return broken test code to the controller for a new budgeted attempt; do not manufacture a report or perform unrecorded reruns. Preserve expected values unless independent evidence proves the previous oracle wrong. Never weaken a test because the creator failed it. Test repair and added checks need a recorded reason, source and new suite hash; rates from different suites are not directly comparable.
5. Return a per-failure diagnosis: assertion id, observed value, expected value and its source, likely cause, and a specific revision suggestion. Do not change creator output or skill code.
6. Save `coverage.json` using `execution.md`'s requirement-to-test format plus each reviewed
   `requirement_id` and `expectation_sha256`. Preserve every planned requirement. A controller
   `unverified` decision must remain unverified with an empty test list, even if all implemented
   assertions pass. The executor checks this before pytest and again when collecting results.
   The map, review and sources remain verifier evidence outside the deployed library.

Coverage here concerns task output behavior, including all required business decisions.
Skill packaging, version, resource portability, forbidden embedded material and construction
isolation belong to executor checks and the trusted controller's mandatory process review,
not to assertions inferred from answers by a verifier forbidden to read the implementation.
Do not transfer output correctness to that review or remove unsupported business requirements.
An accepted virtual measurement alone cannot satisfy the separate deployment review gate.

Before dispatch, the executor reserves `begin-verification`; after the attempt, it records
`finish-verification` with `execution_status: completed`, the actual pytest exit code and
verifier session. If pytest did not start or was interrupted, record `not_started` or
`interrupted` instead, without an exit code. A stale or partial XML cannot establish a valid
measurement in those states. An attempt without a valid report still spends budget. Execute
in the recorded practice environment, using
absolute paths to the newly reserved attempt's report file:

```bash
python3 -m pytest "<virtual_suite>" -q --junitxml="<fresh_report.xml>"
```

Capture the command's exit code immediately and pass it to the shipped parser (whose path is relative to this Skill directory):

```bash
python3 "<skill_dir>/scripts/virtual-results.py" "<fresh_report.xml>" --pytest-exit-code <captured_code>
```

Do not reuse a previous report if pytest failed to write this one. The parser uses the individual JUnit test cases, excludes skipped tests from the denominator, rejects empty/all-skipped suites, duplicate test identities, errors, inconsistent exit codes and more than 60 tests. `status: ok` means the report is valid, not that the skills passed. Only `passed == total`, valid skill structure and coverage of every required check allow `surrogate_pass`. Optional skips must be justified; skipping a required check prevents that exit even when the numeric rate is 1.

Save the parser's JSON as the virtual measurement. A parser `status: failed` has no `pass_rate`; diagnose it and repair the cause in a separately reserved attempt within the retry/time budget. A verifier-failure stop requires evidence that recovery is unavailable; an invalid first report alone does not establish that. Do not substitute 0 or let an LLM estimate a missing rate. Finalize the attempt only after all logs, diagnoses and coverage are written; the helper seals their hashes. Subsequent controller feedback goes in a separate immutable diagnosis file. The scripts need only Python's standard library; pytest is needed to produce the report.

## Diagnosis and retrieval

The controller classifies the failed assertions, verifier evidence and prior domain knowledge, with no target supervision. If a separate classifier is used, supply only these reviewed materials; never expose its process or files to construction containers. This controller-mediated diagnosis replaces the source’s dedicated classifier endpoint and must be reported as an adaptation. Ask for one decision and its brief evidence:

- `SELF-FIXABLE`: the needed rule is already known; fix implementation, format, types or indexing.
- `NEEDS-DR`: a missing domain rule, algorithm choice, reference value or API behavior requires external evidence.

Choose this classification for the proposed repair. A known arithmetic or retrieval-status
bug remains `SELF-FIXABLE` when unrelated policy gaps coexist; those gaps stay in coverage
without blocking that correction or automatically requiring another search.

An unavailable or malformed classifier result defaults to `SELF-FIXABLE`, matching the source. This fallback only selects the retrieval policy; it does not erase a failure or permit an unsupported stop. Record a `feedback` event covering every issue returned by `next`, with diagnosis, immutable evidence, proposed recovery and expected observable change:

- `revise_skill`: correct the reusable procedure, calculation, output contract or packaging, then execute it again. A failed assertion with a supported expected value belongs here unless a concrete execution fault explains it.
- `repair_verifier`: fix test setup/imports/collection, add missing supported checks or correct an independently disproven oracle. Preserve valid assertions. An unknown business rule is not a test implementation fault.
- `repeat_practice`: correct a documented command, path or delivery error and rerun unchanged skills. Do not count it as skill refinement.
- `finish_evidence_limited`: under `bounded-evidence-v1`, close when all supported checks pass
  and only unknown business semantics remain. In `bounded-evidence-v2`, a current skill
  review with no open findings is also required. See [bounded-feedback.md](bounded-feedback.md).
  Do not force skill edits when no defect was observed. A concrete skill defect with no
  failed assertion requires the recorded `skill_findings` described there.

When multiple issues coexist, the diagnosis must describe all of them and the recovery must address them before the next attempt. Skill-structure errors require a skill revision. To override an assertion by repairing the verifier, record `oracle_correction` and the independent evidence; creator output is not evidence of a wrong expectation. If a new attempt reveals a different cause, diagnose that new attempt instead of rewriting an earlier sealed diagnosis.

If a gap is identified and the Case has searches remaining, sanitize the query as SKILL.md requires and reserve `targeted-search` before retrieval. Collect each request with `search-result`, source URLs and immutable raw evidence, including unavailable results. Track topics and decrement the search budget on each issued search; this stricter bound is a declared adaptation of upstream's successful-result counter. Never expand the cap to compensate for empty results. Include actual findings and citations in the creator/verifier feedback. An unfilled reservation supplies no knowledge; a gap with no retrieved evidence stays unresolved and cannot authorize a guessed rule. Bounded evidence permits one recorded `research-fallback` to resume a defensible skill repair with existing knowledge after empty research or search-cap exhaustion. It adds no attempts or time. Without that policy/allowance, document the blocker with the failed retrieval evidence.

## Retry ordering and termination

Use the journal's attempts and `next` guidance; never reconstruct counters from memory. The loop is:

```text
create skills; execute practice task; register execution receipt
while verification budget remains and deadline has not passed:
    reserve attempt; independently verify; record actual execution status and evidence
    if next requires review_skills:
        review the measured revision's documented behavior; retain or independently resolve findings
    if completed valid rate == 1 and structure and required coverage are complete and no open finding:
        finish: surrogate_pass (or time_budget if the deadline has passed)
    if deadline has passed: finish time_budget
    diagnose every issue; record feedback and one recovery action
    if finish_evidence_limited is eligible and selected:
        finish with unknown requirements retained, after process review
    if verifier-only repair and verification budget exhausted: finish max_refinement_retries
    collect required gap research within its existing budget
    if next offers record_research_fallback and a testable skill change is supported:
        record the one allowed fallback, preserving unresolved knowledge
    if recovery is unavailable: record cause/evidence and finish with the actual blocker
    if skill/practice repair: same creator applies it, executes, registers receipt
    otherwise: correct verifier in the next separately reserved attempt
if last skill/practice repair completed and verification budget exhausted:
    finish max_refinement_retries with the final execution marked untested
export the current skill set if structurally valid, otherwise construction_failed
```

The v2 review is required once per measured revision, even if its output tests pass.
It does not consume a verifier attempt, reset the deadline or require a new model call.
The controller must not suppress a concrete skill defect simply because unrelated business
policy is unknown. A clean initial revision can still finish with zero skill changes.
At the verification cap, retain any finding without a current independent regression result
as unresolved, including after a final untested edit. Report changes and confirmed
resolutions separately.

Verifier errors and structural failures spend this retry budget too. If only the verifier needs repair, the retry may keep the skill bytes unchanged; record this instead of forcing a useless skill edit. With the source default 3, there are at most three verification attempts and four practice executions; the final revision after the third failed attempt is not re-verified. If the user changes this to an initial verification plus three verified refinements, label it an adaptation and account for the extra verifier call.

The source's internal episode limits are creator 60 / verifier 20, idle 3 / stale 10, with a context warning at 70% and export/stop at 90%. Penguin subagent turns are not Terminus episodes. Enforce the declared wall-time limit (360 minutes per construction Case by default) from the start of its research, and record that replacement rather than pretending to apply unavailable counters. All questions in a composite Case share the same deadline. A shorter smoke limit requires an explicit request; an existing experiment keeps its recorded limit. Read `next` before dispatch and poll background roles with waits no longer than `min(30, remaining_seconds)` seconds. Budget the first draft and first verifier so feedback can still be applied within the existing total; avoid using the whole window on drafting. Stop when the protocol permits completion rather than waiting for the deadline. This scheduling advice grants no extra time or attempts.

The executor aborts roles and removes their containers at the actual deadline. For an explicit cancellation use `executor.py stop`; after a host crash use `recover` once the old executor has exited. The validator alone does not terminate processes. Pending attempts are collected as completed/interrupted/not-started according to what actually happened. A receipt for practice finished before the deadline can be registered afterward; late work cannot. Do not turn “nearly out of time” into `interrupted` or `verifier_failure`. If measured context usage is available, warn at 70% and stop at 90%; do not repeatedly restart a creator to evade the budget. A stalled role or unsupported verifier must end with concrete cause and recovery evidence, never an automatic pass. An invalid current skill set cannot be replaced by an older revision and called the final OpenSkill result.

At termination record the **current** skill digest, the digest and attempt of the last valid virtual measurement, whether the final practice execution was tested, and any unresolved final issues. `final_was_tested` requires completed execution, a valid report and a saved suite for that practice revision; skill hash equality alone is insufficient. A valid measurement can still contain failed assertions or missing coverage. Report actual skill changes separately from reruns and verifier repairs. Do not carry a previous revision's pass rate forward. No best-of-N restore, no score-based tie-break, and no target evaluation as a substitute verifier.
