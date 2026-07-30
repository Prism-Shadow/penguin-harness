---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark and establish a traceable Formal Baseline. Use when an explicit Test Agent and target capability need a new or revised Benchmark; stop after the baseline and do not optimize the Agent.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 5
updated: 2026-07-29T17:20:58Z
---

# Benchmark Design

Build a multi-Case Benchmark for one Test Agent, calibrate its difficulty, and record a complete Formal Baseline.

This Skill changes the Benchmark, never the Test Agent. It does not run or score the Test Agent. Delegate every evaluation with `run_subagent`, and tell each worker to use `agent-evaluation`. Stop after the Baseline; do not begin optimization.

## Before you start

If the request does not identify a Test Agent, target capability, desired baseline score, and Pilot iteration limit, ask for the missing inputs. When they are already supplied, proceed without asking the user to restate them. Treat the current Agent as the **Builder**. A user-specified evaluation `(provider, model_id)` takes priority; otherwise inherit the current Builder Session's complete `Provider` and `Model ID` from the Environment. Never use a Project default as an implicit evaluation runtime.

## Workflow

- A **Pilot** is a provisional evaluation used to improve the Benchmark. Its results never enter the Scoreboard.
- **Freeze** means the Benchmark revision and evaluation settings stop changing.
- A **Formal Baseline** is the accepted result of a fresh, complete Case × Run evaluation of the frozen Benchmark on one unchanged Agent State version.

Follow this order:

1. Validate the Test Agent, target capability, resolved evaluation Runtime, and evaluation access.
2. Write a Capability Contract that defines the observable process to measure, common weaker behavior, and the general Agent State improvement the Benchmark should train.
3. Plan the complete initial Case set and point allocation. For each Case, privately state the intended behavior, a plausible shortcut for a strong Test Agent, and how the Case distinguishes them. Write and leak-check the complete initial Benchmark.
4. Complete one valid evaluation for every planned Case. Together these results form Pilot iteration 1; finish this complete set before refining any Case.
5. For later Pilot iterations, use scores and Traces to reconstruct how the Test Agent solved each Case. A single iteration may refine multiple Cases or difficulty dimensions; rerun every affected Case.
6. Freeze the first valid Pilot revision that meets the desired baseline score. If none does within the requested valid-iteration limit, restore and freeze the lowest-scoring valid Pilot revision.
7. Run a fresh, complete Case × Run matrix and save it as the Formal Baseline when every cell is valid, the Agent State version remains unchanged, and no known design defect remains. The Formal score does not determine validity.

## Setup and access

Require a Test Agent id, target capability, desired baseline score on the fixed `0..100` scale, and a positive Pilot iteration limit. Derive a short semantic Benchmark id if needed. Resolve `(provider, model_id)` once before the first Pilot: use a user-supplied complete pair when present, otherwise inherit the current Builder Session's `Provider` and `Model ID` from the Environment. Reject a half pair or an unavailable inherited value. Read `thinking_level` from the Test Agent's `model.thinking_level` in `agent_state/system_config.yaml`, using the normal Agent-config default `medium` only when that field is absent. Do not read `thinking_level` from a Trace and do not inspect Project configuration.

The current Session must provide `run_subagent`, and the current Agent must have `agent-evaluation` installed. If either is missing, stop and explain what is needed.

Use the Environment's `App Data Dir` and the explicit Test Agent id:

```text
TEST_AGENT_DIR = <app_data_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <app_data_dir>/agents/<test_agent_id>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark_dir>/scoreboard.yaml
```

Access only the specified Test Agent and Benchmark: the Agent State, complete Benchmark, and Test Traces or artifacts from valid evaluations. Do not access other Agents, Project secrets, or Evaluator State, Workspace, or Trace.

Read the Agent State version from the top-level `version` in `agent_state/system_config.yaml`; use 1 only when it is absent.

## Build the Benchmark

```text
<benchmark_id>/
├── benchmark_config.toml
├── scoreboard.yaml
└── CASE-<nnn>-<semantic-name>/
    ├── statement/
    │   ├── README.md
    │   └── <optional-public-materials>
    └── rubric/
        └── README.md
```

Each Case contains:

- `statement/`, which is public to the Test Agent and defines the objective, available materials, and required artifact.
- `rubric/`, which is private and defines observable scoring items, points, and Gold answers.

Both directories require a `README.md` and may contain supporting files. Do not put Gold answers for evaluated instances, hidden mappings, or private scoring conditions in `statement/`.

Create `benchmark_config.toml` with `title`, `description`, and `runs = 3`. Use another positive Run count only when requested. Initialize `scoreboard.yaml` with `evaluations: []`.

Pass the resolved `(provider, model_id)` explicitly in every Pilot and Formal Evaluator request, starting with the first cell. Freeze that pair and the Test Agent's configured `thinking_level` for the complete Benchmark workflow. Every scored Evaluator result must report the requested pair and the same configured thinking level. A mismatch invalidates the matrix.

Before planning Cases, state the Capability Contract:

- the public evidence available to the Test Agent;
- the observable decisions, intermediate artifacts, and checks the capability requires;
- the weaker behaviors or shortcuts the Benchmark should distinguish; and
- the reusable Agent State behavior that could improve the measured capability.

Before writing each Case, privately record the required behavior, a plausible shortcut for a strong Test Agent, the chosen difficulty, the different scored decision or artifact each behavior should produce, and why the distinction measures the target capability. Design the Case so the measured capability affects the score. Do not optimize the Statement to help the Test Agent succeed or copy this design rationale into it.

The Statement presents the task, not the Benchmark's teaching or design intent. It describes the objective, available materials, option meanings, output format, and necessary constraints. It must not prescribe the reasoning sequence, identify decisive evidence, name the shortcut, or reveal private scoring preferences. When an auditable artifact is needed, request concise supporting evidence without prescribing how to obtain it.

Keep the evaluation contract well-defined, but do not require the public Statement to uniquely determine the Gold. Public information may be incomplete or conflicting, and the Rubric may encode a private decision standard or preference. Fix that private standard before evaluating the revision and never change its Gold after seeing the evaluated answer. The standard must remain tied to the target capability: it should express a stable reusable policy, priority, inference boundary, or other behavior that a better Agent State could apply across instances. Do not use a capability-irrelevant random hidden mapping merely to lower the score, and do not disclose every decisive premise or priority merely to make the public task complete.

The first complete revision is an exploratory probe. Use its Pilot to learn how the Test Agent interprets the tasks, forms candidate rules, and uses shortcuts; refine the Benchmark before treating it as calibrated. A later revision may intentionally add information gaps, conflicts, private preferences, or other capability-relevant distinctions in response to an earlier Trace, provided the next revision's Rubric is fixed before dispatch.

Every Case Rubric has a fixed maximum of 100 points, with observable scoring items and meaningful partial credit. Allocate most points within each Case to decisions or concise artifacts on which the intended behavior and plausible shortcut differ. Keep generic format compliance, evidence enumeration, and analysis completeness from creating a high score floor unless those are themselves the target capability. Allocate points from capability coverage before the first Pilot. Do not change scoring items solely to satisfy the desired score; when a redesign changes coverage, re-plan that Case's 100-point allocation before evaluating the revised Case set. When final choices do not distinguish the intended behavior from a shortcut, score a concise auditable artifact, but define only its required content or format—not the method used to produce it.

Before the first dispatch of every new or changed Case revision, run a consistency review:

- Confirm that the current Statement is internally coherent. Intentional conflicts must be presented as conflicts between sources, rules, or positions rather than as contradictory claims by the Benchmark itself.
- Confirm that the current Rubric is consistent with the current Statement and fixed private standard. It must be self-contained and must not refer to an earlier revision or missing context.
- Confirm that every scoring item applies to the Case's actual requested output and relies only on premises that are defined, provided, or explicitly private under the fixed standard.

This review does not require the public Statement to contain enough information to reproduce the private standard or uniquely derive every Gold answer. Unchanged Cases do not need another review during that iteration. Keep this review in Builder analysis and Trace; fix defects in the Case rather than creating a separate audit artifact.

Also compare all public files with the private Rubric. Confirm that no public file reveals Gold answers, private scoring conditions, or hints that identify the intended solution. This is the leak check.

## Delegate evaluation

For each Case × Run cell, call `run_subagent` with the request below. Dispatch independent cells in parallel up to available concurrency.

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

Inspect the complete streamed and final worker response. Before reading `status`, `score`, or any other protocol field, verify that the worker-authored text is exactly one plain protocol YAML document. Narration, headings, code fences, summaries, or scoring details are not valid protocol. Ask the same Evaluator to resend only the clean YAML from its existing result; do not rerun the Test Agent for a formatting repair and do not extract YAML from the invalid response yourself. Transport metadata added by `run_subagent` is not worker-authored text. A wrong or missing Test Agent artifact is a valid scored result and must not be retried.

For every scored result, require non-empty `provider`, `model_id`, and `thinking_level`. Require the model pair to equal the explicitly resolved pair and the thinking level to equal the Test Agent configuration read before dispatch. Reject a Pilot or Formal matrix whose cells report mixed or mismatched runtimes. The Evaluator verifies provider/model from the root Trace and reports thinking from the unchanged Target Agent configuration; it does not require Trace metadata for thinking.

Correct and resend an `invalid_request`. For `benchmark_invalid`, repair and rerun the affected Case during Pilot; during Formal, abandon the matrix and return to Pilot. For `version_changed`, discard the matrix and restart after the Agent version is stable.

For `evaluation_failed`, keep the same Benchmark revision and cell. Diagnose the failure and retry only when evidence proves the Test Agent did not start and the retry applies a new, specific repair. Do not set a numeric retry limit or repeat an unchanged launch. Stop when no new safe repair remains, external configuration is required, or it is unclear whether the Test Agent started. Never treat an evaluation failure as score zero.

## Refine the Benchmark

Treat the first draft as a hypothesis. The first valid result from every planned Case together forms Pilot iteration 1. A later iteration starts after a difficulty refinement and completes when every affected Case has a valid new result. Request corrections, validity repairs, and evaluation reruns stay in the current iteration and do not consume the requested iteration budget. Use the recorded Agent State version and fixed evaluation runtime.

Keep Pilot results out of the Scoreboard. During calibration, retain only one temporary restorable copy: the lowest-scoring complete valid revision seen so far. Store it outside `benchmarks/`, replace it only when a lower valid revision completes, and never retain invalid revisions.

Use the Pilot to find the current Test Agent's capability boundary.

Before editing, distinguish a validity repair from a difficulty refinement. A validity repair fixes an unusable task or scoring contract and stays in the current Pilot iteration. A difficulty refinement changes what the valid Benchmark measures and completes the next iteration after every affected Case has a valid result.

Before editing, estimate how much of the score the planned refinements can affect. If the range is too small to materially approach the desired score, revise more affected Cases, use more than one difficulty dimension, or replace low-signal Cases.

Prefer refinements that create one or more scored separating decisions. A refinement may change the public task or evidence, introduce or preserve a reasonable information gap or conflict, or apply a fixed private standard. Adding another explicit rule, exception, source, or checklist is not a difficulty increase when the observed strategy can still follow it to the Gold. A Rubric-only refinement is allowed but not preferred when the public task already contains the relevant information, the current Rubric fails to distinguish merely mentioning it from handling it correctly, and the Builder can explain which reusable capability the new scoring distinction measures. Do not add points merely because the previous Test Agent omitted a phrase. Fix the revised Rubric before dispatch and treat it as a changed Case revision.

For each refinement iteration:

1. **Observed strategy.** Reconstruct the Test Agent's actual solution method from its score, artifact, and Trace.
2. **Missing behavior.** Identify the general behavior that the observed strategy skipped or simplified. Repair missing evidence, arbitrary mappings, ambiguity, or scoring defects before increasing difficulty.
3. **Separating prediction.** Before dispatch, predict the decision or artifact the observed strategy will produce, the different result the desired behavior will produce, and the score range affected. If both behaviors are expected to reach the same scored result, choose another refinement.
4. Update any number of diagnosed Cases or difficulty dimensions, run the consistency review and leak check for each changed revision, and rerun every affected Case.

Reuse a Pilot result only when the Case revision, scoring, Agent State version, and evaluation runtime are unchanged.

An information gap or supported alternative is not automatically a design defect. Treat it as a defect only when the task or fixed private standard is incoherent, changes after evaluation, leaks the answer, or no reusable Agent behavior could plausibly improve the score.

More rows, fields, distractors, files, near-duplicate examples, or explicit rule layers do not increase difficulty when the observed strategy still solves the Case. Base refinements on observed behavior and fix the Gold before each evaluation.

Freeze immediately when a complete valid Pilot iteration meets the desired baseline score and no known design defect remains. Do not run another difficulty refinement merely to create more score margin. Otherwise continue through the requested valid-iteration limit. If the desired score is still unmet, restore the temporary lowest-scoring valid revision and proceed to Freeze. Report `calibration_failed` only when no valid Pilot revision can be produced or evaluation failures prevent a valid selection; missing the desired score alone is not a failure.

## Freeze and run the Formal Baseline

After selecting the Pilot revision, restore that exact revision if needed. Run a complete consistency review and final leak check across every Case, fix any defect, then freeze the Benchmark and record the current Agent State version. Run a fresh, complete Case × Run matrix and never reuse a Pilot result. Once the first Formal cell is dispatched, do not change the Benchmark.

Accept the matrix when every cell is valid, every cell reports the frozen evaluation runtime, the Agent State version remains unchanged, the private scoring standard remained fixed, and every score loss reflects the Capability Contract. Record the Formal Baseline even when its score does not meet the desired baseline score.

If Formal reveals a design defect, abandon the matrix and repair the frozen candidate revision before freezing and rerunning the complete matrix. Report `calibration_failed` only when no valid revision remains or evaluation failures prevent a complete Formal matrix. Never record a partial, abandoned, or invalid Formal matrix.

## Record and finish

After validation, obtain the current UTC timestamp from the environment, for example with `date -u +"%Y-%m-%dT%H:%M:%SZ"`, rather than inferring UTC from a displayed local time. Append only the accepted Formal Baseline to `scoreboard.yaml` using exactly this structure:

```yaml
evaluations:
  - time: <ISO-8601 timestamp>
    version: <Agent State version>
    provider: <provider>
    model_id: <model_id>
    thinking_level: <thinking_level>
    summary_title: <public title>
    summary: <public summary>
    score: <average of the Case scores>
    cost: <average of known Case costs, or null when every Case cost is null>
    duration_ms: <average of the Case durations>
    cases:
      - case: <case_id>
        score: <average of the Run scores>
        cost: <average of known Run costs, or null when every Run cost is null>
        duration_ms: <average of the Run durations>
        runs:
          - score: <Run score>
            cost: <Run cost or null>
            duration_ms: <Run duration>
            session_id: <Test Session id>
```

Every Run and Case score is on the fixed `0..100` scale. Do not write `max_score`. Calculate and write every Case and Evaluation average directly in the Scoreboard: ignore `null` values when averaging cost and write `null` only when all contributing costs are unknown; round `score` and `cost` averages to two decimal places and `duration_ms` averages to the nearest integer. These stored values are authoritative—do not add a server, frontend, script, or consistency check that recomputes or validates them. Do not add an `aggregate` object or use `case_id`, `mean_score`, `mean_cost`, or `mean_duration_ms`.

Report the Benchmark path, configuration, Agent State version, Evaluation average and Case Run scores, Test Session ids, and known limitations. Include one compact row per Pilot iteration with its score, diagnosed capability gap, difficulty adjustment, and freeze or stop decision.

After the accepted Formal Baseline is recorded, delete the temporary lowest-revision copy and other Builder calibration scaffolding. Keep the frozen Benchmark, Scoreboard, evaluation Workspaces, and score-linked Traces.

Do not reveal Rubrics, Gold answers, latent rules, per-item scores, or private scoring information. Stop after reporting the Baseline; do not modify the Test Agent or begin optimization.
