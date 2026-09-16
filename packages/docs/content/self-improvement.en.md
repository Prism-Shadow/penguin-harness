---
title: Self-Improvement
description: How Skills build a Benchmark, score an agent on it, and keep only the changes that raise its score, with every version snapshotted and every score traceable.
---

Self-improvement in PenguinHarness is a loop: build a Benchmark for an agent, score the agent on it, change the agent, and keep a change only when the score strictly improves. The loop adds no runtime of its own. Skills orchestrate the ordinary agent machinery: evaluations are ordinary Sessions, optimization is ordinary file editing, and every result is a file in the Project.

Building a Benchmark and optimizing an agent run in two independent top-level Sessions, and each single evaluation is delegated through the built-in `run_subagent` tool. The top-level prompt supplies the settings for the task: the agent, the Benchmark, the capability, the scores and the rounds. The Skills own everything else: call relationships, calibration, Freeze, the result protocol, repair, rollback and reporting.

## Roles

| Role | Skill | Runs as | Responsibility |
| --- | --- | --- | --- |
| Builder | `agent-initialization`, then `benchmark-design` | A top-level Session | Sets up the agent, then writes and calibrates a multi-Case Benchmark and records its baseline |
| Target Agent | — | A fresh top-level Session for every run | The agent being evaluated or improved; it works only inside its own isolated Workspace |
| Evaluator | `agent-evaluation` | A leaf subagent created through `run_subagent` | Runs the Target Agent on one Case once and scores that run |
| Optimizer | `agent-optimization` | A separate top-level Session | Changes the Target Agent under a falsifiable hypothesis and keeps a new version only when its score strictly improves |

No built-in agent is reserved for a role: each role is a Skill, and all four Skills ship in the `agent-tuning` plugin. The Web App calls the Target Agent the **Test Agent** or the **Tested agent**.

### How the roles call each other

1. The Builder or the Optimizer dispatches the full Case × runs matrix in parallel through `run_subagent`: one Evaluator per cell, each told to use `agent-evaluation`.
2. Each Evaluator uses the Penguin CLI to launch the Target Agent once, in a fresh top-level Session and a unique Workspace under the Target Agent's `workspaces/` directory, given by its absolute path. The launch passes `--source benchmark`, so every Test Session lands in the **Evaluations** folder of the Web App's session list instead of among the agent's active conversations. The Evaluator's own Session is an ordinary subagent Session.
3. When the Target Agent finishes, the Evaluator scores the run against the rubric and returns one protocol result: the score, cost, duration and Test Session id. It changes no agent or Benchmark, and never writes `scoreboard.yaml`.
4. The caller checks the complete matrix and writes `scoreboard.yaml`.

Both callers first check that each Evaluator's complete response is plain protocol YAML, and only then read its status or score. When the formatting is invalid, the same Evaluator resends its existing result; the Target Agent is not run again.

## The information barrier

A score is only meaningful while the agent under test cannot see how it is scored. Each role therefore reads a different part of a Benchmark:

| Role | Reads | Does not read |
| --- | --- | --- |
| Target Agent | A copy of the Case's `statement/` in a fresh Workspace, and its own Agent State | The rubric: it never enters that Workspace, and its path is never given |
| Evaluator | The statement, the rubric, the Target Agent's State, and the run's Workspace and Traces | Other agents, Project secrets, unrelated Workspaces or Traces |
| Optimizer | Public statements, the Scoreboard, score-linked Test Traces, and the Target Agent's State | Rubrics, Gold answers, private scoring conditions, the Evaluator's State, Workspace or Trace, other agents, and Project secrets |
| Builder | The whole Benchmark, including the rubrics it writes, the Target Agent's State, and the Test Traces | The Evaluator's State, Workspace or Trace, other agents, and Project secrets |

The Evaluator keeps rubric contents, Gold answers, per-item scores and scoring rationale out of the result it returns. Before a new or changed Case is dispatched, the Builder runs a leak check: no public file may reveal Gold answers, private scoring conditions, or hints that identify the intended solution. If private evaluation information ever reaches the Optimizer's context, the Optimizer rolls back the active Candidate and stops as contaminated.

> [!WARNING]
> The barrier is enforced by Skill instructions and auditable Traces, not by a sandbox. No file-system sandbox, file permission or tool restriction stops an agent from reading a rubric: the Target Agent runs with `--approve allow-all`, its Workspace simply contains no rubric, and the Skills tell the other roles what they may read. Every tool call an agent makes is recorded in its Trace, so a breach can be found afterwards. Project members can also read every rubric in the Web App.

## Building a Benchmark

The first top-level Session creates the agent and its capability evaluation. The Builder follows `agent-initialization`, then `benchmark-design`, and is given the Target Agent, the capability to measure, a desired baseline score and a Pilot iteration limit.

The evaluation runtime is fixed before the first Pilot. A `(provider, model_id)` pair the user specifies takes priority; otherwise the pair is inherited from the Builder Session. The thinking level comes from the Target Agent's `model.thinking_level`, `medium` when the field is absent. Calibration always runs each Case once, so the Builder's `runs` is fixed at 1.

### Designing the Cases

The evaluation contract and the private standard must be clear and fixed. The public statement does not have to determine the Gold answer uniquely. A Benchmark may use incomplete public information, conflicting signals, and a fixed private decision standard, as long as that standard expresses a reusable policy, priority or inference boundary, and is not rewritten after seeing the run's answer.

Most points should rest on decisions or concise artifacts where the intended behavior and a plausible shortcut produce different results. Format, evidence enumeration and analysis completeness should not give a high score floor.

Before the first dispatch of every new or changed Case, the Builder reviews it:

- the statement is internally coherent;
- the rubric agrees with the current statement and the fixed private standard;
- every scoring item relies only on premises that are defined, provided, or explicitly private.

The review does not require the public materials to reproduce the private standard. Before Freeze, the Builder repeats the full review across all Cases.

### Calibrating difficulty

A **Pilot** iteration runs every Case exactly once. The Builder may write the complete initial Case set before Pilot 1, and may refine several Cases or difficulty dimensions in one later iteration.

Before each calibration dispatch, the Builder predicts three things: the result the strategy observed in the Trace will produce, the different result the desired behavior will produce, and the range of the score that is affected. Adding another public rule, exception, source or check that the model can follow directly does not by itself make a Case harder. When both strategies would still reach the same scored result, the Builder picks a different refinement.

### Freezing the baseline

The desired baseline score is a target, not a gate:

- A valid Pilot that meets it allows an early **Freeze**.
- Otherwise the Builder completes the configured number of valid Pilot iterations and freezes the lowest-scoring valid revision. Meanwhile it keeps only the current lowest valid revision and its complete result as a temporary copy.

After a final consistency review, the Builder records the selected Pilot's one-run result directly as the **Formal Baseline**, without rerunning or backfilling runs. It then removes the temporary copy and other calibration scaffolding.

Missing the desired score does not invalidate a Benchmark. The publish gate is a fixed 85: a Formal Baseline below 85 is published. `benchmark-design` reports `calibration_failed` only when no valid Pilot result can be frozen, or when every valid revision still scores 85 or above at the iteration limit.

## Optimizing an agent

After the user confirms that the first step is complete, they start a second top-level Session in a new conversation, and set the `runs` per Case for every Candidate, a target score and a round limit. The Optimizer checks that the Benchmark is `published` and has a complete Formal Baseline for the agent, and then follows `agent-optimization`. If a prerequisite is missing, it stops and explains.

The **Reference** is the Agent State currently kept as best, together with its complete evaluation. Each round tests one **Candidate** built from it:

1. Diagnose capability gaps from the per-Case scores and the score-linked Traces.
2. State one falsifiable hypothesis and make one bounded change: behavioral guidance in `AGENTS.md`, a focused Skill of the agent's own, or safe `system_config.yaml` fields. The Candidate's version is the Reference version + 1, and a rejected version number is never reused.
3. Evaluate the Candidate on the full Case × runs matrix through Evaluators in parallel, with the Reference's provider, model and thinking level.
4. Keep the Candidate only when its evaluation score is strictly higher than the Reference's; otherwise roll it back.
5. Stop early once the target score is reached. Otherwise complete the configured number of valid rounds and keep the highest-scoring Reference.

The Optimizer does not edit `system_prompt` unless asked, and never changes `model.thinking_level`, because the Reference's scores fix the evaluation thinking level. It changes neither the Benchmark, the Test Traces nor the Project configuration. Its only Benchmark write is appending an accepted evaluation to `scoreboard.yaml`.

### Scoring and acceptance

Every accepted Candidate is appended to the Scoreboard and verified immediately. A strictly higher evaluation score decides acceptance. The first comparison sets the Candidate's multi-run average directly against the Formal Baseline's one-run score, without backfilling the baseline. Whether the predicted Case behavior actually changed is reported separately, so that unrelated single-run variation is not presented as evidence of cause.

Optimization needs a complete Formal Baseline in the Scoreboard: without one, there is no improvement to compare against. Rejected Candidates never enter the Scoreboard; the per-round report stays in the conversation.

### Failures and stopping

Invalid evaluations and correction reruns do not count toward the round limit; a complete, valid evaluation of a rejected Candidate does. When an execution fails, the Optimizer keeps the same Candidate and repairs only the missing cell. It keeps trying as long as each attempt follows a new diagnosis and applies a different safe repair.

The Optimizer also stops on contamination, on `version_changed` or `benchmark_invalid`, or when no safe repair remains.

## Starting from the Web App

The Web App's [Evaluation Center](/evaluation-center) starts the same two top-level Sessions without a hand-written prompt. Its dialogs prefill the request, with the matching Skills selected, into a new conversation, and nothing runs until you send it. The dialogs never choose the Target Agent's evaluation runtime. For the steps, see [Evaluation Center](/evaluation-center).

## Benchmark storage

Benchmarks belong to the Project. Each one is stored in `<root>/<project>/benchmarks/<id>/`, a sibling of `agents/`. Benchmarks and agents are peers rather than owner and owned: one Benchmark can evaluate several agents, and one agent can be evaluated by several Benchmarks. So `benchmark_config.toml` names no agent; each evaluation records the agent it tested.

```text
<project>/benchmarks/<id>/
├── benchmark_config.toml       # Benchmark configuration: title, description, runs (Builder runs is fixed at 1), status
├── <case-id>/
│   ├── statement/              # the task given to the Target Agent
│   └── rubric/                 # private scoring rubric, isolated from the Target Agent
└── scoreboard.yaml             # evaluation records (current format)
```

`rubric/` is kept apart from `statement/` on purpose: the Target Agent receives only the task statement and never the scoring rubric.

`benchmark_config.toml` is what makes a directory a Benchmark: a directory under `benchmarks/` without one is not listed. A Benchmark that has never been evaluated still has its config and is listed as usual. Deleting a Benchmark while an evaluation is still running leaves such a config-less directory behind, because the running evaluation keeps writing to its paths; it is safe to delete by hand.

### Benchmark status

`status` says whether the Benchmark is finished:

| Status | Set when | In the Web App |
| --- | --- | --- |
| `draft` | `benchmark-design` is still writing the cases and calibrating their difficulty | Masked: no **Use**, no detail page |
| `published` | The Formal Baseline is recorded | Usable |
| `failed` | `benchmark-design` reports `calibration_failed` | Masked as a failed creation, with a request to delete it and create it again |

A failed Benchmark cannot be used. A Benchmark created by hand, and the built-in example, are published from the start. A config without the field, or with any value other than `draft` or `failed`, reads as published.

### Evaluation records

Each evaluation record in `scoreboard.yaml` is timestamped and carries:

- `agent_id`, the agent the evaluation tested. Together with `model_id` and `thinking_level`, it forms the record's **label**. The trend chart plots score against time with one series per label, and only scores under the same label are comparable. The Agent State `version` is not part of the label: successive versions of one agent on one runtime are the trend the chart exists to show, so they share a line, and each point names its version on hover. A record written before evaluations carried an agent reads as unlabelled and falls into the chart's grey series.
- The evaluation runtime: `provider`, `model_id` and `thinking_level`. For the baseline, a `(provider, model_id)` pair the user specifies takes priority; otherwise the pair is inherited from the Builder Session. An optimization reuses the Reference's runtime. `thinking_level` is read from the Target Agent's config, not from Trace metadata.
- `summary_title` and `summary`: the round's conclusion and the hypothesis for the next one.
- Score, cost and duration averages, written by the model. Case-level values average the runs, and evaluation-level values average the Cases. Run cost keeps its recorded precision. Cost averages ignore `null` inputs and are `null` only when every contributing cost is unknown. Scores use two decimals, cost averages six, and `duration_ms` is an integer.
- Per-Case run details: each run records `score`, `cost`, `duration_ms` and `session_id`.

Every run and every Case is scored out of 100, so Scoreboard entries carry no `max_score`. The server and the Web App trust the stored averages and neither recompute nor cross-check them. Older Scoreboard formats are not migrated or backfilled.

### The example Benchmark

Initializing a Project's `default_agent` seeds an example Benchmark at the Project level (`packages/core/src/state/example-benchmark.ts`). Its three sample evaluations are labelled `agent_id: default_agent`, so the evaluation pages have data out of the box. The whole directory can be deleted or replaced at any time.

The check looks only at the example's own directory, `benchmarks/example-benchmark/`. Whenever it is missing and `default_agent` is initialized or loaded, the example is written, whatever else `benchmarks/` holds, and whatever an older data root still keeps at the retired per-agent location `agents/<agent>/benchmarks/`, which nothing reads. An example that is present is never touched, and a deleted one comes back on the next load.

## Snapshots and versions

The `version` field in `system_config.yaml` is the Agent State version. It increases with each accepted optimization.

Before the Optimizer changes a Reference State, it makes sure `<agent>/snapshots/v<version>.tar.gz` exists for the Reference version. It reuses an existing snapshot, and otherwise creates one by archiving `agent_state/` without the Vault (`.vault.toml`): secrets never enter a snapshot. It never overwrites a snapshot of the same version, and if it cannot create one, it stops before changing anything. A rejected Candidate is rolled back in the same round: the Optimizer restores the original files and version and removes files the Candidate created.

In the Web App, an agent's settings page offers **Export snapshot** to any member and **Import snapshot** to the Project owner. An import replaces the whole Agent State, takes the `version` inside the package, and keeps the current Vault; the current version is snapshotted first. Importing a version that is not newer than the current one asks for confirmation. The create dialog on the Agents page can also start a new agent from an exported package (**Initialize from a snapshot**): the agent starts with the package's state and version, with no confirmation.

## Auditability

- Every Evaluator run and every Test Session is an ordinary Session with a full Trace.
- Scoreboard records link back to the Test Sessions through `session_id`. See [Sessions & Traces](/sessions-and-traces).
- The Web App's evaluation pages are read-only views of these files. The trend chart shows Score only; the evaluation table shows the tested agent, the model ID and the thinking level in separate columns. See [Evaluation Center](/evaluation-center).

Every score can be traced back to the run that produced it.

## Related Skills

| Skill | Purpose |
| --- | --- |
| `agent-initialization` | Turn a requirement into a working agent: write its `AGENTS.md` and install the Skills it needs |
| `benchmark-design` | Design and calibrate a multi-Case capability Benchmark |
| `agent-evaluation` | Run and score one isolated Benchmark Case run |
| `agent-optimization` | Improve an agent from Benchmark results |

How Skills are organized and installed is covered in [Skills](/skills).
