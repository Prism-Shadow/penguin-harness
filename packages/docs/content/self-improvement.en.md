---
title: Self-Improvement
description: Use Skills to create or reproduce benchmarks, evaluate a Target Agent, and improve its harness with an RSI method.
---

The default Penguin method is a loop: build a Benchmark for an agent, score the agent on it, change the agent, and keep a change only when the score strictly improves. The loop adds no runtime of its own. Skills orchestrate the ordinary agent machinery: evaluations are ordinary Sessions, optimization is ordinary file editing, and every result is a file in the Project.

The Root Agent, usually Default Agent, delegates each phase to a Supervised Agent
and creates its independent Supervisor companion. The five task Skills import
`agent-supervision`; each task child gets its own companion and reports to its
own parent.

## Roles

| Role | Work |
| --- | --- |
| Root Agent | Creates pairs, tracks task/attempt states, stops abnormal work and joins reports |
| Builder | Initializes the Target and designs or reproduces its Benchmark |
| Optimizer | Analyzes permitted training traces and updates the Target Harness |
| Evaluator | Runs one Target attempt and privately scores its saved artifact |
| Target Agent | Solves one assigned task with a fixed harness and fresh context |
| Supervisor Agent | Observes one assigned execution from release through final audit |

These are workflow roles. Builder, Optimizer, Evaluator, Target and Reporter can
all be Supervised Agents. Supervisors are leaf observers. Six Skills ship in
`agent-tuning`; Target/Test Agent denotes the same task-solving role in either
training or testing. Root is the delegating role, not another name for Supervisor.

### Pair lifecycle and recovery

The parent binds both Sessions, waits for Supervisor readiness, then releases the
task. Independent case pairs can run in parallel within the declared budget.
A tool subagent is limited to one level; further logical delegation uses explicitly
registered server Sessions. CLI Targets are created with source `benchmark` before
starting work, so they still appear in the Evaluation Center's session folder.

The companion reads actual instructions and trace actions. On an anomaly it
immediately alerts the parent, which stops the executor and confirms termination.
For confirmed cheating, a new pair repeats the same work with specific corrective
**user instructions**, without changing system prompt/config or persistent State.
The first execution plus three retries is the limit; a clean low score is accepted
without retry. Continued cheating on attempt 4 receives a policy zero and a reason,
while raw grader output and all attempts remain available in private records.

The Root's task list records work ID, both Sessions, attempt, status and pending
alerts. Both members finish before the pair closes. No-growth traces require
status checks; missing evidence is incomplete coverage, not a clean result.
Evaluator result YAML remains separate from audit reports. The caller applies
terminal penalty scores with an explicit reason in a separate report, not the
ordinary baseline scoreboard; penalties cannot certify a
Formal Baseline, train a method or validate a contaminated harness. A supervised
recovery score is distinguished from an improvement learned in the harness.

## The information barrier

A score is only meaningful while the agent under test cannot see private scoring information. The following table describes the default Penguin method; other RSI methods declare their training feedback permissions in their references. Testing remains outside the Optimizer context.

| Role | Reads | Does not read |
| --- | --- | --- |
| Target Agent | A copy of the Case's `statement/` in a fresh Workspace, and its own Agent State | The rubric: it never enters that Workspace, and its path is never given |
| Evaluator | The statement, the rubric, the Target Agent's State, and the run's Workspace and Traces | Other agents, Project secrets, unrelated Workspaces or Traces |
| Optimizer | Public statements, the Scoreboard, score-linked Test Traces, and the Target Agent's State | Rubrics, Gold answers, private scoring conditions, the Evaluator's State, Workspace or Trace, other agents, and Project secrets |
| Builder | The whole Benchmark, including the rubrics it writes, the Target Agent's State, and the Test Traces | The Evaluator's State, Workspace or Trace, other agents, and Project secrets |

The Evaluator keeps rubric contents, Gold answers, per-item scores and scoring rationale out of the result it returns. Before a new or changed Case is dispatched, the Builder runs a leak check: no public file may reveal Gold answers, private scoring conditions, or hints that identify the intended solution. If information outside the selected method's permissions reaches the Optimizer, it restores an active candidate it owns and stops as contaminated.

> [!WARNING]
> Role separation depends on Skill instructions and audited Traces; a fresh workspace alone is not enforced isolation. Companion Sessions preserve the parent’s effective approval and sandbox policy. When that policy permits broad access, the absent Rubric in the Target workspace does not prevent reading it elsewhere. Record actual confinement and observation limits. Project members can also read Rubrics in the Web App.

## Building a Benchmark

A supervised Builder phase creates the agent and its capability evaluation. The Builder follows `agent-initialization`, then `benchmark-design`, and is given the Target Agent, the capability to measure, a desired baseline score and a Pilot iteration limit.

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

## Reproduce an existing benchmark

Use `benchmark-reproduction` with a GitHub URL, benchmark name or local checkout.
It follows the matching benchmark reference, the generic construction rules,
or a user-supplied construction prompt. Official training/testing
splits become `<name>_train` and `<name>_test`. Long-running tasks keep identical
task definitions and use an explicit trial/time boundary and environment handoff.

The Skill builds native Statement/Rubric files, checks a few complete executions
through `agent-evaluation`, verifies Evaluation Center visibility, then asks before
running the full evaluation. Smoke results are development checks, not a full
baseline. Existing task difficulty is preserved; the below-85 calibration gate
applies only to newly designed benchmarks. Datasets and adapters are created on
demand in the Project, not bundled into Penguin or installed as defaults.

`agent-optimization` applies an RSI method to the Target Agent. It uses Penguin
by default; other methods are defined in references. Specify the method in the
request and read its recipe for the update and selection rules. Inputs, evaluation
and output formats are defined in the Skill. The loop below describes Penguin's
strict-improvement policy.

## Optimizing an agent

After the user confirms that the first step is complete, they start a second top-level Session in a new conversation, and set the `runs` per Case for every Candidate, a target score and a round limit. The Optimizer checks that the Benchmark is `published` and has a complete Formal Baseline for the agent, and then follows `agent-optimization`. If a prerequisite is missing, it stops and explains.

For the default Penguin method, the **Reference** is the Agent State currently kept as best, together with its complete evaluation. Each round tests one **Candidate** built from it:

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
| `agent-supervision` | Pair delegated work with an independent companion, immediate alerts and bounded recovery |
| `agent-initialization` | Turn a requirement into a working agent: write its `AGENTS.md` and install the Skills it needs |
| `benchmark-design` | Design and calibrate a multi-Case capability Benchmark |
| `benchmark-reproduction` | Reproduce an existing benchmark and verify smoke runs before a full evaluation |
| `agent-evaluation` | Run and score one isolated Benchmark Case run |
| `agent-optimization` | Improve an agent from Benchmark results |

How Skills are organized and installed is covered in [Skills](/skills).
