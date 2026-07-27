---
name: benchmark-design
description: Design and calibrate a multi-Case capability Benchmark and establish a traceable Formal Baseline. Use when an explicit Test Agent and target capability need a new or revised Benchmark; stop after the baseline and do not optimize the Agent.
short_description: Design and calibrate an Agent capability Benchmark.
short_description_zh: 设计并校准 Agent 能力评测 Benchmark。
version: 5
updated: 2026-07-27T05:28:09Z
---

# Benchmark Design

Build a multi-Case Benchmark for one Test Agent, calibrate its difficulty, and record a complete Formal Baseline.

This Skill changes the Benchmark, never the Test Agent. It does not execute or score the Test Agent: delegate every evaluation with `run_subagent` to an independent worker explicitly instructed to use `agent-evaluation` skill. Stop after the baseline; do not begin optimization.

## Workflow

- A **Pilot** is a provisional evaluation used to improve the Benchmark. Its results never enter the Scoreboard.
- **Freeze** means the Cases, Statements, supporting files, Rubrics, Gold answers, points, `runs`, and evaluation Model stop changing.
- A **Formal Baseline** is a fresh evaluation of every frozen Case, repeated for every configured Run, on one unchanged Agent State version, whose aggregate score satisfies the baseline gate.

Follow this order:

1. Validate the Test Agent, target capability, evaluation Model, and evaluation access.
2. Define the observable behavior that demonstrates the capability and draft the smallest useful Pilot.
3. Delegate one evaluation per Pilot Case.
4. If the Pilot does not expose the target difficulty, refine one capability-relevant dimension and rerun the affected Cases. Use at most three Pilot iterations.
5. Freeze the complete Benchmark after a final leak check.
6. Delegate every frozen Case for the configured number of Runs. Save the result as the Formal Baseline only if all Runs complete on the same Agent version and the aggregate score satisfies the baseline gate.

## Setup

Require an explicit Test Agent id, the capability to measure, one exact evaluation `(provider, model_id)` pair, and a baseline score gate. Ask for any missing value; derive a short semantic Benchmark id if needed.

The current Session must provide `run_subagent`, and the current Agent must have `agent-evaluation` installed. If either is unavailable, stop; return `missing_run_subagent` for the missing tool. Never fall back to `penguin run` or score a Case yourself.

Use the Environment's App Data Dir:

```text
TEST_AGENT_DIR = <app_data_dir>/agents/<test_agent_id>
BENCHMARK_DIR = <test_agent_dir>/benchmarks/<benchmark_id>
SCOREBOARD = <benchmark_dir>/scoreboard.yaml
```

You may access the specified Test Agent State, the complete specified Benchmark, and only those Test Traces and artifacts returned by successful evaluations of this Benchmark. Do not access another Agent, Project secrets, or the evaluation worker’s own State, Workspace, or Trace.

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

Create `benchmark_config.toml` with `title`, `description`, and `runs = 3`; use another positive Run count only when the user requests it. Select the evaluation `(provider, model_id)` before the first Pilot and keep it fixed through Formal. Initialize `scoreboard.yaml` with `evaluations: []`.

Before writing Cases, describe how an Agent with the target capability should behave differently from one without it. Every Case must require that difference; sharing the same topic is not enough. Across all Cases, Rubric maxima must total 100 points. Use observable scoring items and meaningful partial credit.

Before the first Pilot, compare each public Statement and supporting file with its private Rubric. Remove any public content that reveals a hidden rule, expected outcome, Gold answer, or scoring condition. This is the leak check.

## Run evaluations

The Benchmark Designer never executes or scores the Test Agent. For every Pilot or Formal evaluation:

1. Call `run_subagent` to start an independent worker.
2. Tell the worker to use `agent-evaluation` for exactly one Case and one Run.
3. Send the complete request below.
4. Use only the returned protocol YAML as the evaluation result; ignore commentary.

   ```text
   Use the `agent-evaluation` Skill and evaluate exactly this Case run.
   protocol_version: 1
   case_id: <case_id>
   run: <1_based_run_index>
   expected_version: <test_agent_state_version>
   test_agent_id: <test_agent_id>
   benchmark_id: <benchmark_id>
   provider: <provider>
   model_id: <model_id>
   ```

Track requests separately by phase, Pilot iteration, Case, Run, and attempt so results from different Benchmark revisions cannot be mixed. Do not launch a duplicate while a request is pending or after it has returned a valid result. Independent requests may run in bounded parallel batches.

Distinguish evaluation failure from ordinary Test Agent failure. A wrong or missing Test artifact is a valid scored result and must not be retried.

Handle an evaluation failure by its cause:

- For `cli_failed` or `provenance_mismatch`, retry the same cell once only when the Agent State and Benchmark are unchanged.
- For `invalid_request`, correct the request and resend it; this does not consume a Pilot iteration.
- For `invalid_statement` or `invalid_rubric`, repair the affected Benchmark files, invalidate that Case's results, and return to Pilot before evaluating it again.
- For `invalid_score`, repair the Rubric or scoring contract only when the cause is clear; otherwise stop.
- For `version_changed`, discard the whole matrix, stabilize the Agent State version, and restart.

During Formal, any Benchmark or scoring repair abandons the current matrix and requires a new freeze. Never convert an evaluation failure into score zero. A Formal Baseline requires a valid result for every Case and Run.

## Refine the Benchmark

Treat the first draft as a hypothesis, not the final Benchmark. Run one representative evaluation per Case as Pilot iteration 1 on the recorded Agent State version and fixed evaluation Model. Keep Pilot results out of the Scoreboard.

A high Pilot score is not a reason to freeze. Use its Case scores and returned Test Traces to decide whether the Agent genuinely has the capability or the Cases allow a shortcut. Refine only when the evidence shows that the Benchmark does not require the intended behavior.

For each refinement iteration:

1. Identify one shortcut, missing dependency, or weak requirement that made the Pilot too easy.
2. State one refinement hypothesis: the difficulty dimension to change and the capability failure it should expose.
3. Change only that dimension. Options include stronger evidence integration, meaningful conflicts or distractors, cross-file dependencies, deeper decisions, or new comparable instances.
4. Update all affected public and private Benchmark files consistently, discard invalidated results, run the leak check, and rerun the affected Cases. This is the next Pilot iteration.

An unchanged Case result may carry forward only when its Statement, supporting files, Rubric, Gold answers, points, Agent State version, and evaluation Model are all unchanged. Otherwise rerun that Case too.

Use Pilot output to identify a missing capability demand, not to choose the correct answer. Do not change Gold merely to contradict the Agent, tighten only the private Rubric, add arbitrary ambiguity, or create a Case-specific trap. Choose hidden rules independently and keep them fixed during each iteration. Any required output or action must be stated publicly, but a latent rule or mapping may remain private when recovering it through score feedback is the capability being measured.

Stop refinement when the user's gate is satisfied, after three Pilot iterations, or when no credible capability-relevant refinement remains. If the score is still high, report that the Benchmark remains too easy to measure meaningful improvement; do not manufacture difficulty.

## Freeze and run the Formal Baseline

1. Freeze the complete Benchmark and run the final leak check.
2. Start a fresh ledger and record the current Agent State version.
3. Delegate every Case × Run cell; never reuse a Pilot run.
4. Accept the matrix only if every cell succeeds and the Agent State version remains unchanged.

Do not change the Benchmark after the first Formal cell is dispatched. If a design defect appears, or the complete Formal score misses the baseline gate and the Traces reveal a credible shortcut, abandon the whole matrix and return to refinement only if the three-iteration budget has room. After any permitted change, freeze again and rerun the entire Formal matrix.

If the complete Formal score misses the gate and no refinement budget or credible refinement remains, report `calibration_failed` and stop without a Baseline. Record nothing from a partial, abandoned, invalid, or above-gate matrix.

## Record and finish

Write only a complete Formal result that satisfies the baseline gate to `scoreboard.yaml`. Each Evaluation records `time`, Agent State `version`, `provider`, `model_id`, public `summary_title` and `summary`, aggregate `score`, `cost`, `duration_ms`, and nested Case and Run results. Each Case records its mean metrics; each Run records `score`, `cost`, `duration_ms`, and Test `session_id`. If any contributing cost is unknown, use `null` for the containing Case and Evaluation cost.

Validate the Scoreboard through a temporary file, then replace it atomically. A later material Benchmark change starts a new Pilot and invalidates results that are no longer comparable. Evaluators never write the Scoreboard.

Report the Benchmark path, configuration, Agent State version, aggregate and Case scores, Test Session ids, and limitations. Include one compact row per Pilot iteration: score, diagnosed capability gap, single difficulty adjustment, and freeze or stop reason.

Do not reveal Rubrics, Gold answers, hidden rules, per-item scores, or diagnostics that expose private scoring conditions. Stop after reporting the baseline; do not modify the Test Agent or begin optimization.
