---
name: openskill-rsi-toolkit
description: Run OpenSkill (Open-World Self-Evolution for LLM Agents, Yan et al. 2026). Retrieve domain knowledge and verification anchors, refine skills using independent virtual tests without target supervision, freeze the last revision, then evaluate the Target on its Benchmark.
version: 2026.10.28.6
---

# OpenSkill

[Open-World Self-Evolution for LLM Agents](https://arxiv.org/abs/2606.06741v1), §2 and Appendices A.5, B and F; implementation at [OpenLAIR/OpenSkill](https://github.com/OpenLAIR/OpenSkill), verified revision `84ca182da055fafb6453dcec4a6defdbbfd987c1`. The learned artifact is a set of reusable Skills. Open-world retrieval supplies both domain knowledge and verification anchors; independent virtual tests guide refinement. Freeze the last revision before consulting target-task supervision. Model weights stay fixed. See `references/source-notes.md` for source locations, an ambiguity in the paper and the declared Penguin adaptations.

## Native Benchmark entry

Read `references/native-benchmarks.md` first. Start from the selected published Benchmark in this Project; resolve its actual statements and source revision instead of asking for a GitHub experiment recipe. The shipped `native_benchmark.py` binds public inputs, current task paths and domain Train/Test pairs without reading scoring material. Keep the controller, creator and independent verifier roles and the freeze boundary below.

Read `references/experiment-organization.md` to schedule and report the experiment. Build
one library per selected Benchmark or independent training unit, then test the same frozen
Baseline and final States on the complete evaluation set three times by default. These
are repeated measurements of one learned library, not three independent learning runs.
Keep the per-Case persistent creators and independent virtual verifiers below.

## Before you start

This Skill is a top-level controller. Construction uses the dedicated `scripts/executor.py` and `scripts/launch.mjs`, with Linux, local Docker, Node 24+, the built Penguin core SDK and a reviewed practice image. It also needs external research tools, shell access and Python 3.11+; the image needs Python and pytest. Final evaluation uses `run_subagent` and `input_subagent` as the shared evaluation reference specifies. If a prerequisite is missing, name it before creating an experiment. If the request only names this Skill, ask for the Target and a published Benchmark. Resolve only missing inputs:

- `test_agent_id`: another Agent in this Project, or `create: <id>` for a fresh one. Never use the Agent running this controller as the Target.
- `benchmark_id`, `case_ids`: a published Benchmark; all its Cases unless a subset is supplied. A Case is one OpenSkill construction task. Do not merge Cases into a shared training history.
- `test_benchmark_id`, `test_case_ids` (optional): a separate published Benchmark for held-out evaluation. Declare its ids from metadata only; do not expose its tasks to construction. When provided, baseline and final measurements use this set instead of the construction set. Without it, retain the same-task protocol. Report this transfer setting as an adaptation.
- `runs`: complete evaluation repetitions of each frozen State, default 3; an explicit user-supplied count wins. Record the published manifest's run count separately without editing it. Each repetition covers every selected evaluation Case with fresh environments and conversations. This experiment setting replaces the paper's five-run default; it never multiplies construction or virtual refinement rounds. Existing journals keep their recorded count.
- `experiment_version`, `component_versions`, `reporting_metric`: fix report identity, actual component versions and the Benchmark's metric definition before launch as `references/result-records.md` specifies. Prefer requested versions when preparing the environment; report the versions actually used. The helper assigns a stable experiment version at initialization when none is supplied. Label a score accuracy only when the Benchmark defines it as accuracy.
- Target `provider` and `model_id`: the complete pair the user supplied, otherwise this Session's Environment pair. Fix its `thinking_level` from the Target's State. Construction roles use this controller's model unless the user specifies another complete pair; record both runtimes.
- `max_refinement_retries`: 3; `max_targeted_searches`: 3 per Case; `max_virtual_tests`: 60; the skill plan contains 1–4 skills per Case, fixed before drafting. Stop on virtual pass rate 1.0 and complete structural checks when no observed skill defect remains. Retain the last revision, regardless of earlier rates.
- `include_baseline`: true unless the user asks for final evaluation only. Baseline measurement is deferred until every Case's skills are frozen.
- `feedback_policy`: `bounded-evidence-v2` for new isolated runs. Review each measured skill revision before choosing feedback or closing. Keep observed skill defects separate from failed assertions, verifier faults and unknown business rules. A known defect requires a real resource change, fresh practice and independent regression evidence before resolution, even if the proxy passed. Unknown rules alone need no manufactured revision. One documented research fallback per Case can return to skill repair within the original attempts and deadline. Passing supported checks with no unresolved skill findings can close as `evidence_limited`, never as full acceptance. Explicit `strict` or `bounded-evidence-v1` retains its recorded policy. See `references/bounded-feedback.md`.
- `include_reader_control`: false; enable only for an explicitly requested empty-library ablation. It adds a frozen State with the same reader mechanism but no learned content; it never selects skills or replaces the original baseline.
- `construction_timeout_minutes`: 360 (6 hours) per construction Case by default, shared by research, creator work, practice, verification and feedback revisions. A composite GDPevo Train Case shares this budget across all its questions. Stop early when the protocol's stopping conditions are met; the limit does not require spending six hours. Use a user-supplied limit when given; a 30-minute smoke run must be explicitly requested. Record any additional token budget and observable context limit; do not invent token usage when the host does not expose it. This engineering wall-time limit replaces the source's internal episode counters; it is separate from the Benchmark's final evaluation timeout. Existing experiments retain their recorded budget.
- `recovery_policy`: for new experiments use `{ "version": 2, "max_tool_recoveries": 6, "max_same_error_recoveries": 2, "recovery_seconds": 180, "max_execution_repairs": 2, "max_verifier_repairs": 1 }`. These are engineering allowances per Case, shared across revisions, within the original Case deadline. Same-family command failures from one model response share an allowance; the next response can correct them. Ordinary command failures can recover, and exhausted local recovery returns to a budgeted execution repair. In version 2 a local `edit_file` text mismatch inside the writable role working directory is a bounded local correction (`edit_file:EditMismatch`) under the same per-family allowance; a mismatch while editing frozen `skills/` or `inputs/` remains an immediate boundary fault. Up to two failed-practice repairs can add two practice executions; verifier repairs also spend the original verification attempts. Declare these allowances before launching. If the user instead requires every execution fault to stop immediately, omit this policy and set `stop_on_recurrence: true`. Do not combine the two modes or change a running experiment's policy. Explicit version 1 and unversioned existing recovery configurations keep their earlier rules.

Before starting, state C construction Cases, up to `C × (1 + max_refinement_retries)` practice executions, up to `C × max_refinement_retries` verification attempts (including verifier repairs), up to `C × max_targeted_searches` targeted searches, and `(1 + include_baseline + include_reader_control) × T × runs` final Target executions. T is the declared test-set size when supplied, otherwise C. Initial domain and verification research are additional. Research, diagnosis and revisions also consume tokens. Do not silently expand budgets or run paid external services without the user's existing authorization.

With graded recovery, also declare at most `C × max_execution_repairs` additional practice
executions and the local correction allowances. When `next` returns `repair_execution`,
submit the evidenced `execution_recovery` decision described in `references/executor.md`.
No failed delivery is a registered revision or a virtual measurement. A successful command
after a temporary error permits continuation only; independent verification remains required.
Select additional `research_files` only from sealed searches marked `retrieved`; unavailable
search responses remain controller diagnostics. Invalid file maps are refused before role
dispatch and budget reservation. Correct the request within the existing deadline; never
count a dispatch refusal as a failed virtual test or bypass a STOP caused by changed evidence.

**Evaluation timing.** The Evaluation Center’s generic “baseline and every candidate” tail does not add a scoring stage to OpenSkill: virtual revisions receive independent virtual tests; only the untouched baseline and final frozen State receive Benchmark evaluation, after the global freeze. State this timing and proceed. An explicit user request to use real target scores during construction conflicts with OpenSkill and needs clarification before execution; never label supervised optimization as OpenSkill. Once target scores, rubrics, answer traces or reference solutions have entered a construction session, do not use that session for supervision-free learning on these tasks. This also applies to task feedback automatically injected from the controller Agent's memory or State: a new child conversation alone does not remove it. Use a clean construction Agent and context in that situation.

## Paths and experiment record

Resolve from the Environment, as `references/evaluation.md` does:

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
PENGUIN_HOME = dirname of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = PROJECT_DIR/benchmarks/<benchmark_id>
SNAPSHOTS    = TARGET/snapshots
OUT          = PROJECT_DIR/agents/<controller_agent_id>/scratchpad/<session_id>/openskill-rsi-toolkit/<experiment_id>
```

Use a unique timestamp and Target id for `experiment_id`. Validate ids and canonical paths; reject traversal and symlink escapes. Never read vaults, `.project_config.toml`, API tokens or `web.db`. Keep research, verifier scripts, practice outputs and diagnostics in OUT, outside the Target's State and the Benchmark. Only the controller publishes State and appends final evaluations.

Read `references/executor.md` and `references/execution.md`; initialize a new `isolated-v1` journal through `scripts/executor.py` before construction. All mutations go through that executor. Do not substitute unrestricted subagents or a shared practice container for construction roles. Record actual runtime, installed Skill hash, baseline snapshot and declared budgets; use JSON serialization rather than handwritten YAML. The journal tracks phases, creator identity, revisions, attempts, recovery evidence, searches and final-versus-tested hashes. Use `status` when resuming and the read-only `next` command before dispatch or waiting; its deadline and remaining seconds govern scheduling. This version creates schema-2 journals for new runs. Resume older runs with their recorded Skill version; do not migrate or overwrite previous experiments, installed skills or snapshots. New isolated runs cannot accept hand-written role receipts through the legacy helper. Use `executor.py stop` for cancellation and `recover` after a host crash; neither silently reruns work.

Initialization imports the configured host SDK, checks its interfaces and creates/disposes a
temporary Session without a model turn, then preflights every construction image before
creating a journal. Prefer the current installation’s complete built core SDK; see
`references/executor.md`. Use `scripts/prepare_runtime.py` only when a separate pinned runtime
is actually needed. Never overlay new SDK build files on an older installation. Each role checks the runtime fingerprint recorded at initialization.
For graded recovery, follow `references/executor.md`'s error classes and fixed budgets.
Known local practice errors may be corrected within a bounded window; frozen-skill defects
return to authoring, and invalid verification records require explicit feedback and another
budgeted attempt. Unclassified faults, isolation failures, changed evidence and exhausted
recovery budgets fence the experiment. Completed virtual assertion failures and honestly
unverified requirements remain eligible for normal feedback and refinement.
For GDPevo, select `executor.startup_profile: gdpevo` as described in `references/executor.md`.
It starts the private service as its owner and checks business readiness and role isolation.
A failed preflight fences that directory; preserve its evidence and start a new run only after
resolving the failure. Each subsequent role and measurement repeats its readiness checks.

**Stopped experiments.** A STOP fence is permanent. Never delete or rewrite it, hand-edit the
journal, replace the fenced role, or report the role as successful. If a practice was fenced
after it had produced every declared deliverable and only a controller-owned delivery defect
remains (for example a probe script the role was still editing), the controller may use
`executor.py resume-delivery` once for that Case to register those exact answer bytes as a
continuation revision. It must first verify the original STOP digest, the practice skill/input
hashes and the isolation record; it keeps the failed role's `completed=false`, records
`role_success_claimed=false`, changes only the declared repair files, and runs the required
probes inside a boundary that still carries the original STOP. If the fenced practice already
holds a changed skill set, the live tree must still equal the last registered revision; the
continuation imports that practice's skills as an explicitly recorded `revise_skill`, with the
previous and imported hashes, instead of leaving an unregistered tree. This is a delivery
repair, not
a successful role, a new practice attempt or feedback-driven skill revision. It resets no
local recovery count, adds no verification attempt and never extends the Case deadline.
`executor.py resume-verifier` may then spend exactly one separate independent re-verification
that reuses the sealed plan and suite; that replay is recorded separately and does not refund
the original attempt. If a hash differs, the STOP changed, isolation was breached or any
required probe fails, stop and report. A retained continuation STOP blocks the global freeze
unless the journal records the continuation and every Case is finished and deployable; after
that freeze it may also carry the evaluation journal events, because construction is closed
and the frozen artifact is measured, never used for further learning. Record
that exception as a recovery deviation. Never edit answers, lower a valid assertion or claim
the fenced role succeeded to make a check pass.

Keep each Case's allowlisted input manifest, raw and sanitized queries, source URLs and retrieval dates, `knowledge.md`, `plan.yaml`, `verification-knowledge.md`, role requests/replies and diagnostics under `OUT/tasks/<case_id>/`. Keep every practice output and test attempt in a distinct directory. Historical revisions are audit records, never candidates for score-based selection. The executor confines role file and command tools and controls measured execution. The controller still reviews source content, output allowlists and feedback: isolation does not prove semantic independence or test correctness. See `references/executor.md` for the trust boundary and supported environments.

## Initialize without scoring

Follow `references/initialization.md`. Snapshot the untouched baseline, prepare an empty `skills/openskill-library/` in OUT, and stage public inputs for each Case. Do not call `references/evaluation.md`'s workers yet. Do not open the Benchmark's rubric, scoreboard, `.jobs`, reference solutions or prior Target traces. Reading `benchmark_config.toml` to establish publication and the construction Case’s public statement is allowed. Grouped GDPevo inputs and the paired held-out package follow `references/native-benchmarks.md`; never use its real training judge for virtual feedback.

For Harbor Cases, separate the public task instruction and environment from the statement's evaluation-launch recipe. Use only the pinned task's instruction and allowlisted environment inputs for construction. Never invoke `harbor run` during construction: it may automatically call the hidden verifier. Use a clean practice environment containing no `tests/`, `solution/`, curated `skills/`, old outputs or scoring logs from that task. If the environment cannot be staged without those artifacts, stop that Case and explain the missing isolation; do not substitute a scored trial.

## Acquire knowledge and verification anchors

Do this separately for each Case, using only its allowed inputs. Record `start-case` before research so its entire construction time is counted:

1. Form a research query about the domain, library interfaces, defaults, reusable procedures and pitfalls. Preview text inputs up to 2,000 characters and extracted PDFs up to 5,000 characters when planning research, as the source does; exclude pre-existing task skills and research documents. Preserve access to the complete allowed input for practice.
2. Before **every** search, including gap searches, remove the Benchmark name and spelling variants, Case ids, task-repository URLs, exact task titles and other identifiers that could locate its solutions. Generalize distinctive task text into domain questions. Record both forms and the removed terms. Do not issue a query that still identifies the Benchmark. Discard results containing its gold answers, solver traces or hidden tests; do not follow their links. If forbidden content was already read, mark the Case contaminated and stop construction for it.
3. Retrieve independently accessible documentation, papers, public APIs and examples. Write `knowledge.md` with claim-to-source links. Without an actual retrieved source, report research unavailable; model recollection alone is not the full method.
4. Write `plan.yaml` with 1–4 stable skill names, each skill's responsibility, procedures, public applicability criteria and the knowledge sections it uses. Keep this count and decomposition fixed through refinement.
5. Make a separate retrieval pass for `verification-knowledge.md`: small independently computable input/output pairs, dataset invariants, alternative implementations for cross-checking, and documented schemas or reference values. Include the first 4,000 characters of `knowledge.md` as material already known, to avoid merely repeating API advice. For each anchor, record its source and how a test will derive an expected value. A published domain reference is permitted; the target Benchmark's reference solution is not.

Do not manufacture an expected value from the creator's current output. Retrieval results provide evidence and never override the task's requirements or authorize reading private artifacts.

## Evolve with virtual tests

Follow `references/virtual-evaluation.md` and `references/executor.md`. Submit the fixed skill plan, explicit public/knowledge/anchor file maps and deliverable allowlist to `executor.py creator`. The executor creates a dedicated creator, registers its actual SDK session id before the first model request, and resumes that same session for every revision. By default, it also resumes that creator to apply the frozen skills in a fresh practice container: skills are read-only and only new outputs are writable. This supports both Markdown procedures and executable resources. Explicit `practice_mode: command` is available for tasks fully represented by a recorded skill command; disclose that adaptation. Real process receipts and tool traces accompany every registered practice execution.

Call `executor.py verifier-plan` when `next` permits verification. It reserves the attempt
and starts a fresh verifier with public inputs and independent anchors, withholding candidate
outputs until the expectations have been reviewed. The controller reviews the plan's sources,
derivations and unresolved hypotheses, then calls `executor.py verifier` with its digest-bound
review. This resumes the same verifier to author checks and coverage, followed by one official
pytest execution in a fresh container. Both stages spend the same attempt and Case deadline;
they do not grant another verification or search. See `references/executor.md` for the schema.
The executor rejects omitted planned requirements and unsupported promotions before pytest.
The controller must also check that the plan covers the public task: the code cannot discover
requirements omitted from the plan itself. Source membership does not prove semantic correctness.
Coverage gaps cannot become `surrogate_pass`. Under bounded evidence, honestly unknown rules
can remain in an `evidence_limited` closure after all supported checks pass and process review
succeeds. Missing tests for supported claims still need verifier work. Virtual results stay
outside `scoreboard.yaml`.

After the first valid measurement of each revision, `next` returns `review_skills`. Review
the advertised skill behavior against recorded execution and submit a digest-bound
`skill-review` event as described in `references/bounded-feedback.md`. Retain known defects
across verifier repairs. A passing output suite cannot erase an observed interface defect;
send the evidenced finding to the same creator and independently test the changed behavior.
This controller review is a Penguin adaptation and remains within the Case deadline.
It is not an automatic semantic audit or a requirement to produce at least one revision.

After an unsuccessful verification or a review with unresolved skill findings, record `feedback` before continuing. Cover all observed assertion failures, skill findings, verifier errors and coverage gaps. Distinguish `SELF-FIXABLE` from `NEEDS-DR`; a classifier failure defaults to `SELF-FIXABLE`. Specify evidence, diagnosis, expected observable change and one action: `revise_skill`, `repair_verifier`, `repeat_practice` or, when eligible, `finish_evidence_limited`. Real assertion failures normally require skill repair; an oracle correction needs independent evidence. Unknown rules alone neither prove a skill defect nor require repeated verifier repairs. If tests pass but the controller observes a concrete skill defect, record it in the skill review and attach the active `skill_findings` to feedback. Never fabricate a failed test or a cosmetic edit to demonstrate RSI.

Retrieve only on `NEEDS-DR`, reserving a `targeted-search` before each issued request and recording its actual `search-result`. A failed search consumes budget but supplies no knowledge. If `next` offers `record_research_fallback`, record the unresolved gaps, observed defect, planned reusable change and validation before resuming the same creator. This single allowance uses existing knowledge, not invented policy; unsuccessful search files remain diagnostics. Pass the diagnosis and any retrieved evidence back to the same creator. Change reusable skills/scripts and execute them in a new output directory; never patch an output by hand. An unchanged skill digest cannot count as `revise_skill`. Use `repeat_practice` only for a documented execution/delivery fault; verifier-only repair reserves a fresh attempt without a fabricated skill revision.

The source checks the failure-retry cap **before** the next verification: after three failed verifications it can deliver a third revision and export it without another virtual test. Match that ordering. Apply the last recorded skill/practice repair while budget remains, then export it as untested; verifier-only repair at the cap stops without an extra attempt. Stop earlier on a complete virtual pass, a declared budget limit, contamination or an evidenced unrecoverable blocker. A bare `verifier_failure` or `interrupted` label cannot replace recoverable work. Preserve the final valid skill set even when the virtual proxy did not pass; do not roll back to a higher earlier proxy score. A missing/invalid skill set is a construction failure and prevents deployment.

## Freeze, deploy and evaluate

1. Finish **all** construction Cases with `finish-case`, after their creator/verifier processes stop writing. New isolated runs require a controller `process_review` record bound to the last skill/output digests; review delivery, portable content and construction isolation separately from the verifier's output tests (see `references/executor.md`). Unresolved review blocks deployment; never mark it passed just to finish. Assemble each Case's last registered skills under `OUT/library/tasks/<case_id>/<planned_skill_name>/`. Include the portable contracts, reusable content and declared resources; exclude task answers, practice outputs, tests, scores, diagnostics, conversation history and scratch paths. Packaging fixes must occur before registering and closing that Case's last revision.
2. Generate the fixed reader and public applicability index described in `references/initialization.md`. Call the journal's `freeze` action, which checks the library against every Case's final digest, plan and historical evidence. Save its manifest as `OUT/freeze.json`, outside the library. No learning, retrieval, test expansion or skill editing is allowed after this point, including on Cases not yet evaluated.
3. Deploy the library as one new Target State, snapshot it, and record its version and full State digest. Across multiple Cases this is a library selected by public task scope, an adaptation of the paper's per-task deployment; report it. Never use rubric information or evaluation scores for routing.
4. Only now, register measured State versions/hashes with `begin-evaluation` and follow the journal's fixed `evaluation_plan` through `references/evaluation.md`. Restore baseline, optional reader control and final snapshots in turn, measuring the same evaluation Case × runs matrix and runtime. With a held-out Benchmark, only its tasks are evaluated. Take a State digest before and after each matrix. If State or Benchmark content changes, invalidate the matrix, restore the appropriate snapshot and stop evaluation; do not use results as learning feedback. Preserve the vault during restoration.
5. Append only complete, valid matrices using the reference's exact scoreboard schema. Use titles such as `OpenSkill baseline · 42.00` and `OpenSkill final · 57.00`; the public summary records the library digest, budget and final revision policy, never private scoring details. An incomplete matrix has no aggregate score. Even if baseline evaluation fails, finish on the frozen final State and report what was not measured; never silently count failed infrastructure as a Target failure.
6. Finish on the frozen final State at its measured version, even if its Benchmark score is below baseline. Submit `finish-evaluation`, retaining complete worker matrices or an explicit incomplete report. Construction stays closed permanently. Further separately authorized measurements may use the same frozen artifact without reopening this journal; a new learning experiment needs a fresh uncontaminated construction context and cannot claim independence if supplied previous scoring feedback.

Snapshot and restore exactly as `references/initialization.md` specifies. There is no baseline test before learning, no candidate ranking by target score, and no best-of-N selection. A virtual pass is only a proxy; it does not imply a target pass.

## Report

Use the [common report fields](references/result-records.md#common-report-fields): `baseline` and `final` for the two frozen States, `run` for test repetitions, and `mean`, `std` and `final_minus_baseline` for the comparison. Keep training stages separate from test repetitions.

Read `references/result-records.md`. Record pre-training base and final Test means, `std`
and final-minus-baseline gain; both States are measured after freeze. Collect cost in USD,
start/end/elapsed time and cached-input, uncached-input, output, total-input and total
tokens for each construction unit and every test Case/repetition/State. Keep Train, Test,
controller and whole-experiment totals separate, including failed-attempt consumption.
Use native artifacts or recorded usage only; unavailable values remain null with coverage.
Retain virtual measurement and revision history, with no invented ground-truth Train curve.

Use `scripts/evaluation_results.py` as described in `references/experiment-organization.md`
to validate complete matrices and calculate their scores. Report every repetition score,
its mean and sample standard deviation (`n−1`) for Baseline and final. Across Benchmarks,
average Benchmark scores within each repetition first, then calculate the overall mean
and sample standard deviation. Keep per-Case statistics separate. One repetition has no
sample standard deviation; one construction has no across-training-run standard deviation.
Never pool all Case scores or average Case/Benchmark standard deviations for the headline.

Report the source paper and pinned implementation, all adaptations, the frozen library path/hash and retained State version. Separate virtual outcomes from final Benchmark scores (baseline/final, per-Case results, coverage and runs). Per construction Case, report practice executions, skill changes after feedback, verifier attempts versus valid measurements, unresolved issues, retrieval outcomes, research fallbacks, final tested status and evidenced stop reason. Distinguish full virtual acceptance, supported checks passing with evidence limitations, and execution failure. Zero skill changes means no recorded skill refinement; byte changes alone do not prove improvement. When no baseline was measured, do not claim an improvement. Report recorded construction and evaluation costs separately, marking unavailable usage as unknown. Link the experiment records and snapshots. Complete final measurements appear in the Evaluation Center under `<agent_id> · <model_id> · <thinking_level>`; intermediate virtual rounds remain in OUT. Do not claim to reproduce the paper's published benchmark numbers.

Audit Target skill usage as `references/skill-contract.md` describes, outside construction contexts. Separate self-reported selection, confirmed reads and evidence of application. Report scoring status separately from execution termination, including timeouts even when artifacts received full reward. Neither usage evidence nor evaluation diagnostics permit post-freeze refinement.
