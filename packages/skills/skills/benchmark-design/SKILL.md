---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark and establish a traceable Formal Baseline. Use when an explicit Test Agent and target capability need a new or revised Benchmark; stop after the baseline and do not optimize the Agent.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 7
updated: 2026-07-27T10:30:43Z
---

# Benchmark Design

Build a multi-Case Benchmark for one Test Agent, calibrate its difficulty, and record a complete Formal Baseline.

This Skill changes the Benchmark, never the Test Agent. It does not run or score the Test Agent. Delegate every evaluation with `run_subagent`, and tell each worker to use `agent-evaluation`. Stop after the Baseline; do not begin optimization.

## Workflow

- A **Pilot** is a provisional evaluation used to improve the Benchmark. Its results never enter the Scoreboard.
- **Freeze** means the Cases, Statements, supporting files, Rubrics, Gold answers, points, `runs`, and evaluation Model stop changing.
- A **Formal Baseline** is a fresh evaluation of every frozen Case, repeated for every configured Run, on one unchanged Agent State version, whose aggregate score satisfies the baseline gate.

Follow this order:

1. Validate the Test Agent, target capability, evaluation Model, and evaluation access.
2. Define the observable behavior, plan the Case set and point allocation, then draft the Cases incrementally.
3. Complete and leak-check one Pilot Case, dispatch its evaluation in the background, then draft the next Case without waiting for the result.
4. If the Pilot does not expose the target difficulty, refine one capability-relevant dimension and rerun the affected Cases. Use at most three Pilot iterations.
5. Freeze the complete Benchmark after a final leak check.
6. Delegate every frozen Case for the configured number of Runs. Save the result as the Formal Baseline only if all Runs complete on the same Agent version and the aggregate score satisfies the baseline gate.

## Setup

Require a Test Agent id, the capability to measure, one exact evaluation `(provider, model_id)` pair, and a baseline score gate. Ask for any missing value. Derive a short semantic Benchmark id if needed.

The current Session must provide `run_subagent`, and the current Agent must have `agent-evaluation` installed. If either is unavailable, stop. Return `missing_run_subagent` when the tool is missing. Never fall back to `penguin run` or score a Case yourself.

Use the `Project Dir` from the Environment:

```text
TEST_AGENT_DIR = <project_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <test_agent_dir>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark_dir>/scoreboard.yaml
```

You may access the specified Test Agent State and the complete specified Benchmark. You may also inspect Test Traces and artifacts returned by successful evaluations of this Benchmark. Do not access another Agent, Project secrets, or the evaluation worker’s own State, Workspace, or Trace.

Read the Test Agent State version from the top-level `version` in `agent_state/system_config.yaml`; use 1 only when it is absent.

## Build the Benchmark

```text
<benchmark_id>/
├── benchmark_config.toml
├── scoreboard.yaml
└── CASE-<nnn>-<semantic-name>/
    ├── statement/
    │   └── README.md
    └── rubric/
        └── README.md
```

Each Case has two parts:

- `statement/` is public to the Test Agent. It defines the objective, available materials, and required artifact.
- `rubric/` is private. It defines observable scoring items, points, and Gold answers.

Both directories require a `README.md` and may contain supporting files. Never put hidden reasoning, mappings, Gold answers, or scoring conditions in `statement/`.

Create `benchmark_config.toml` with `title`, `description`, and `runs = 3`. Use another positive Run count only when the user requests it. Select the evaluation `(provider, model_id)` before the first Pilot, then keep it fixed through Formal. Initialize `scoreboard.yaml` with `evaluations: []`.

Before writing Cases, describe how an Agent with the target capability should behave differently from one without it. Every Case must require that difference. Sharing the same topic is not enough. Rubric maxima across all Cases must total 100 points. Use observable scoring items and meaningful partial credit.

Before evaluating a Pilot Case, compare its public Statement and supporting files with its private Rubric. Keep every public rule, piece of evidence, and example needed to answer the Case. Remove Gold answers for evaluated instances and private scoring conditions; do not remove necessary evidence merely because it helps infer the answer. This is the leak check.

## Run evaluations

The Benchmark Designer owns the Pilot and Formal evaluation sets. This includes their Case and Run loops, concurrency, ledger, and returned failures. The Evaluator handles one cell and may retry only a launch that failed before the Test Agent started.

For each required `(case_id, run)` pair, call `run_subagent` once with the complete prompt below. This delegates exactly one execution to an independent worker, which must use `agent-evaluation` to run and score that cell.

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

Accept only the worker's protocol YAML. Ignore transport metadata added by `run_subagent`; worker-authored narration makes the result invalid.

Track each cell by phase, Pilot iteration, Case, Run, and attempt as `queued`, `in_flight`, or `completed`. Never dispatch an `in_flight` or valid `completed` cell again.

Launch independent evaluations as soon as they are ready, up to available concurrency. When a worker finishes, immediately launch the next pending evaluation. During the initial Pilot, dispatch each Case as soon as it is written and leak-checked, then continue drafting the next Case. Do not modify an in-flight Case. After all evaluations are dispatched, wait for the remaining workers.

A wrong or missing Test Agent artifact is a valid scored result and must not be retried.

When an evaluation returns `status: failed`:

- For `invalid_request`, correct the request and resend it.
- For `benchmark_invalid`, repair the affected Case, discard its invalidated Pilot results, and evaluate it again.
- For `version_changed`, discard the current matrix and restart after the Agent version is stable.
- For `evaluation_failed` or an invalid protocol, stop the current matrix. Do not redispatch the cell or convert the failure into score zero.

If a Benchmark or scoring repair is required during Formal, abandon the Formal matrix, return to Pilot, freeze again, and rerun Formal from the beginning. A Formal Baseline requires a valid result for every Case and Run.

## Refine the Benchmark

Treat the first draft as a hypothesis, not the final Benchmark. For Pilot iteration 1, run one representative evaluation per Case. A Pilot iteration is complete when every current Case revision has one valid result. Use the recorded Agent State version and fixed evaluation Model. Keep Pilot results out of the Scoreboard.

A high Pilot score is not a reason to freeze. Review the Case scores and returned Test Traces. Decide whether the Agent genuinely has the capability or the Cases allow a shortcut. Refine only when the Benchmark fails to require the intended behavior.

A low Pilot score is also not enough to freeze. Confirm that every scored outcome is supported by public materials and that the observed misses reflect a capability a general Agent State change could improve. If the low score comes from missing evidence, an arbitrary private mapping, or unresolved ambiguity, repair the Case.

For each refinement iteration:

1. Identify one shortcut, missing dependency, or weak requirement that made the Pilot too easy.
2. State one refinement hypothesis: the difficulty dimension to change and the capability failure it should expose.
3. Change only that dimension. Options include stronger evidence integration, meaningful conflicts or distractors, cross-file dependencies, deeper decisions, or new comparable instances.
4. Update every affected public and private Benchmark file. Discard invalidated results, run the leak check, and rerun the affected Cases. This starts the next Pilot iteration.

Reuse a Pilot result only when nothing that affects it changed. This includes the Statement, supporting files, Rubric, Gold answers, points, Agent State version, and evaluation Model. Otherwise, run that Case again.

Use Pilot output to find a missing capability demand, not to choose the correct answer. Do not change Gold merely to contradict the Agent. Do not tighten only the private Rubric, add arbitrary ambiguity, or create a Case-specific trap. Choose hidden rules independently and keep them fixed during each iteration. State every required output or action publicly. Keep a latent rule or mapping private only when public evidence or examples make it recoverable.

Stop when the user's gate is satisfied, after three Pilot iterations, or when no credible refinement remains. If the score is still high, report that the Benchmark remains too easy to measure meaningful improvement. Do not manufacture difficulty.

## Freeze and run the Formal Baseline

1. Freeze the complete Benchmark and run the final leak check.
2. Start a fresh ledger and record the current Agent State version.
3. Put the complete Case × Run matrix into one `queued` list and dispatch it through the evaluation scheduling rules above; never reuse a Pilot run.
4. Accept the matrix only if every cell succeeds and the Agent State version remains unchanged.

Once the first Formal cell is dispatched, do not design or refine any Case or otherwise change the Benchmark. If a design defect appears, abandon the whole matrix. Do the same when the Formal score misses the gate and the Traces show a credible shortcut. Return to refinement only when the three-iteration budget has room. After any change, freeze again and rerun the entire Formal matrix.

If the complete Formal score misses the gate and no credible refinement remains within the budget, report `calibration_failed`. Stop without a Baseline. Record nothing from a partial, abandoned, invalid, or above-gate matrix.

## Record and finish

Write only a complete Formal result that satisfies the baseline gate to `scoreboard.yaml`. Record `time`, Agent State `version`, `provider`, `model_id`, public `summary_title` and `summary`, aggregate `score`, `cost`, `duration_ms`, and nested Case and Run results. Each Case stores its mean metrics. Each Run stores `score`, `cost`, `duration_ms`, and Test `session_id`. If any contributing cost is unknown, use `null` for the containing Case and Evaluation cost.

Validate the Scoreboard through a temporary file, then replace it atomically. A later material Benchmark change starts a new Pilot and invalidates results that are no longer comparable. Evaluators never write the Scoreboard.

Report the Benchmark path, configuration, Agent State version, aggregate and Case scores, Test Session ids, and limitations. Include one compact row per Pilot iteration: score, diagnosed capability gap, single difficulty adjustment, and freeze or stop reason.

Do not reveal Rubrics, Gold answers, hidden rules, per-item scores, or diagnostics that expose private scoring conditions. Stop after reporting the baseline; do not modify the Test Agent or begin optimization.
