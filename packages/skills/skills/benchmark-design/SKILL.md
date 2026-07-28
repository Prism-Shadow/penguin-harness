---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark and establish a traceable Formal Baseline. Use when an explicit Test Agent and target capability need a new or revised Benchmark; stop after the baseline and do not optimize the Agent.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 11
updated: 2026-07-28T13:10:00Z
---

# Benchmark Design

Build a multi-Case Benchmark for one Test Agent, calibrate its difficulty, and record a complete Formal Baseline.

This Skill changes the Benchmark, never the Test Agent. It does not run or score the Test Agent. Delegate every evaluation with `run_subagent`, and tell each worker to use `agent-evaluation`. Stop after the Baseline; do not begin optimization.

## Before you start

If the request does not identify a Test Agent, target capability, evaluation Model, and desired baseline score, ask for the missing inputs. When they are already supplied, proceed without asking the user to restate them.

## Workflow

- A **Pilot** is a provisional evaluation used to improve the Benchmark. Its results never enter the Scoreboard.
- **Freeze** means the Benchmark revision and evaluation settings stop changing.
- A **Formal Baseline** is the accepted result of a fresh, complete Case × Run evaluation of the frozen Benchmark on one unchanged Agent State version.

Follow this order:

1. Validate the Test Agent, target capability, evaluation Model, and evaluation access.
2. Write a Capability Contract that defines the observable process to measure, common weaker behavior, and the general Agent State improvement the Benchmark should train.
3. Plan the Cases and point allocation. Design one Case at a time as an exploratory probe: privately state the intended behavior, a plausible shortcut for a strong Test Agent, and how the Case distinguishes them. Then write, leak-check, and dispatch one Pilot Run before moving to the next Case.
4. Complete one valid evaluation for every planned Case. Together these results form Pilot iteration 1; finish this complete set before refining any Case.
5. For Pilot iterations 2–5, use scores and Traces to reconstruct how the Test Agent solved each Case, deepen one capability-relevant difficulty dimension, and rerun the affected Cases.
6. Freeze the first valid Pilot revision that meets the desired baseline score. If none does within five valid Pilot iterations, restore and freeze the lowest-scoring valid Pilot revision.
7. Run a fresh, complete Case × Run matrix and save it as the Formal Baseline when every cell is valid, the Agent State version remains unchanged, and no known design defect remains. The Formal score does not determine validity.

## Setup and access

Require a Test Agent id, target capability, evaluation `(provider, model_id)`, and desired baseline score. Ask for any missing input and derive a short semantic Benchmark id if needed.

The current Session must provide `run_subagent`, and the current Agent must have `agent-evaluation` installed. If either is missing, stop and explain what is needed.

Use the `Project Dir` from the Environment:

```text
TEST_AGENT_DIR = <project_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <test_agent_dir>/benchmarks/<benchmark_id>
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
    │   └── README.md
    │ rule.md
    └── rubric/
        └── README.md
```

Each Case contains:

- `statement/`, which is public to the Test Agent and defines the objective, available materials, and required artifact.
- `rubric/`, which is private and defines observable scoring items, points, and Gold answers.

Both directories require a `README.md` and may contain supporting files. Do not put Gold answers for evaluated instances, hidden mappings, or private scoring conditions in `statement/`.

Create `benchmark_config.toml` with `title`, `description`, and `runs = 3`. Use another positive Run count only when requested. Select the evaluation `(provider, model_id)` before the first Pilot and keep it fixed through Formal. Initialize `scoreboard.yaml` with `evaluations: []`.

Before planning Cases, state the Capability Contract:

- the public evidence available to the Test Agent;
- the observable decisions, intermediate artifacts, and checks the capability requires;
- the weaker behaviors or shortcuts the Benchmark should distinguish; and
- the reusable Agent State behavior that could improve the measured capability.

Before writing each Case, privately record the required behavior, a plausible shortcut for a strong Test Agent, the chosen difficulty dimension, and the evidence and evaluated instances that separate the shortcut from the intended behavior. Design the Case so the intended capability is necessary and the shortcut is likely to fail. Do not optimize the Statement to help the Test Agent succeed or copy this design rationale into it.

The Statement presents the task, not the Benchmark's teaching or design intent. It describes the objective, available materials, option meanings, output format, and necessary constraints. It must not prescribe the reasoning sequence, identify decisive evidence or examples, name the capability or shortcut, or tell the Test Agent which rules, priorities, or checks to derive. Publicly answerable does not mean guided. When an auditable artifact is needed, request concise supporting evidence without prescribing how to obtain it.

The first Case revision is an exploratory probe. Use its Pilot to learn how the Test Agent interprets the task, forms candidate rules, and uses shortcuts; refine the Case before treating it as calibrated.

After fixing the Gold, test whether a simpler proxy based on public features, identifiers, or examples can reproduce every evaluated answer without the target behavior. If it can, add or replace an instance where that proxy and the intended behavior produce different outputs.

Rubric maxima across all Cases must total 100 points, with observable scoring items and meaningful partial credit. Allocate points from capability coverage before the first Pilot. Do not change Case weights solely to satisfy the desired score; when a redesign changes coverage, re-plan the allocation before evaluating the revised Case set. When final choices do not distinguish the intended behavior from a shortcut, score a concise auditable artifact, but define only its required content or format—not the method used to produce it.

Before evaluating a Pilot Case, compare all public files with its private Rubric. Ensure the public materials contain enough evidence to derive every scored answer without identifying which evidence is decisive or how to combine it. Exclude Gold answers for evaluated instances, private scoring conditions, and hints that reveal the intended solution. This is the leak check.

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

Inspect the complete streamed and final worker response. Accept a cell only when its worker-authored text is exactly one plain protocol YAML document. Narration, headings, code fences, summaries, or scoring details make the protocol invalid; do not extract YAML from them. Transport metadata added by `run_subagent` is not worker-authored text. A wrong or missing Test Agent artifact is a valid scored result and must not be retried.

Correct and resend an `invalid_request`. For `benchmark_invalid`, repair and rerun the affected Case during Pilot; during Formal, abandon the matrix and return to Pilot. For `version_changed`, discard the matrix and restart after the Agent version is stable. Stop on `evaluation_failed` or an invalid protocol. Never treat an evaluation failure as score zero.

## Refine the Benchmark

Treat the first draft as a hypothesis. The first valid result from every planned Case together forms Pilot iteration 1. A later iteration starts after a difficulty refinement and completes when every affected Case has a valid new result. Request corrections, validity repairs, and evaluation reruns stay in the current iteration and do not consume the five-iteration budget. Use the recorded Agent State version and fixed evaluation Model. Keep Pilot results out of the Scoreboard.

After each complete valid Pilot iteration, preserve a restorable copy of that Benchmark revision outside the final Benchmark directory and record its total score. Do not keep invalid revisions in the selection pool.

Use the Pilot to find the current Test Agent's capability boundary.

Classify each change before editing:

- A **Definition refinement** repairs ambiguity in the capability, public evidence, accepted answers, or scoring contract. It must not reveal the intended solution or add hints to the Statement, and it stays in the current Pilot iteration.
- A **Difficulty refinement** adds a reasoning dependency after the definition is stable and passes the separating-instance test below. Its valid rerun completes the next Pilot iteration.

Before editing, estimate how much of the Case score the proposed refinement can affect. If that range is too small to materially approach the desired score, redesign more instances within the same difficulty dimension or replace a low-signal Case.

For each refinement iteration:

1. **Observed strategy.** Reconstruct the Test Agent's actual solution method from its score, artifact, and Trace.
2. **Missing behavior.** Identify the general behavior that the observed strategy skipped or simplified. Repair missing evidence, arbitrary mappings, ambiguity, or scoring defects before increasing difficulty.
3. **Separating instance.** Specify an evaluated instance where the observed strategy and missing behavior lead to different outputs. Confirm that public evidence uniquely supports the intended output.
4. Change only the selected difficulty dimension; one dimension may span multiple separating instances. Update the affected files, run the leak check, and rerun the affected Cases.

A change is a Difficulty refinement only when the observed strategy produces a wrong or unsupported result on the separating instance while the missing behavior reaches the uniquely supported Gold. If no such instance can be constructed, choose another difficulty dimension.

Reuse a Pilot result only when the Case revision, scoring, Agent State version, and evaluation Model are unchanged.

Before treating a score loss as a capability gap, identify the public evidence that rules out the Test Agent's answer. When multiple interpretations remain supported, perform a Definition refinement and rerun the Case. A final Case may contain insufficient or conflicting evidence when the public task defines the expected uncertainty action or accepted answer set.

For a high score, create valid new instances that pass the separating-instance test. More rows, fields, distractors, files, near-duplicate examples, or explicit exceptions do not increase difficulty when the observed strategy still solves the Case.

Base refinements on the observed general strategy. Generate Gold through an Agent-independent process and keep every answer recoverable from public materials.

Freeze immediately when a complete valid Pilot iteration meets the desired baseline score and no known design defect remains. Do not run another difficulty refinement merely to create more score margin. Otherwise continue through at most five valid Pilot iterations. If the desired score is still unmet, restore the lowest-scoring valid Pilot revision and proceed to Freeze. Report `calibration_failed` only when no valid Pilot revision can be produced or evaluation failures prevent a valid selection; missing the desired score alone is not a failure.

## Freeze and run the Formal Baseline

After selecting the Pilot revision and completing the final leak check, restore that exact revision if needed, freeze the Benchmark, and record the current Agent State version. Run a fresh, complete Case × Run matrix and never reuse a Pilot result. Once the first Formal cell is dispatched, do not change the Benchmark.

Accept the matrix when every cell is valid, the Agent State version remains unchanged, and no known design defect remains. Every scored answer must be supported by public evidence, every accepted alternative must be explicit, and every score loss must reflect the Capability Contract. Record the Formal Baseline even when its score does not meet the desired baseline score.

If Formal reveals a design defect or credible shortcut, abandon the matrix. Repair the defect without counting evaluation retries as a new Pilot iteration, or select the next-lowest valid preserved revision when the selected revision is no longer eligible. Freeze again and rerun the complete matrix. Report `calibration_failed` only when no valid revision remains or evaluation failures prevent a complete Formal matrix. Never record a partial, abandoned, or invalid Formal matrix.

## Record and finish

After validation, append only the accepted Formal Baseline to `scoreboard.yaml` using exactly this structure:

```yaml
evaluations:
  - time: <ISO-8601 timestamp>
    version: <Agent State version>
    provider: <provider>
    model_id: <model_id>
    summary_title: <public title>
    summary: <public summary>
    score: <sum of the Cases' average Run scores>
    cost: <sum of the Cases' average Run costs; null if any Run cost is unknown>
    duration_ms: <sum of the Cases' average Run durations>
    cases:
      - case: <case_id>
        max_score: <maximum score for one Run of this Case>
        runs:
          - score: <Run score>
            cost: <Run cost or null>
            duration_ms: <Run duration>
            session_id: <Test Session id>
```

The Case `max_score` values must total 100. Do not add an `aggregate` object or use `case_id`, `mean_score`, `mean_cost`, or `mean_duration_ms` in the Scoreboard.

Report the Benchmark path, configuration, Agent State version, total and Case Run scores, Test Session ids, and known limitations. Include one compact row per Pilot iteration with its score, diagnosed capability gap, difficulty adjustment, and freeze or stop decision.

Do not reveal Rubrics, Gold answers, latent rules, per-item scores, or private scoring information. Stop after reporting the Baseline; do not modify the Test Agent or begin optimization.
