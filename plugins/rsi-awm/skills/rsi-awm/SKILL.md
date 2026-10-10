---
name: rsi-awm
description: Run AWM (Agent Workflow Memory, Wang et al. 2024) on an agent - induce reusable workflows from its successful trajectories, online over a training stream or offline from supplied experiences, then freeze the workflow memory and measure it on a published Benchmark.
---

# AWM

[Agent Workflow Memory](https://arxiv.org/abs/2409.07429), Wang et al., 2024 ([arXiv:2409.07429v1](https://arxiv.org/abs/2409.07429v1), §2.1–2.3 and Appendix A). GitHub: [zorazrw/agent-workflow-memory](https://github.com/zorazrw/agent-workflow-memory). Verified implementation revision `8c0ff8cd11d648c8fceb99e4e42f37e3b75381b1`, chiefly `mind2web/offline_induction.py`, `mind2web/memory.py`, `mind2web/prompt/`, `webarena/pipeline.py`, `webarena/induce_prompt.py` and `webarena/autoeval/`. AWM induces **workflows**, reusable sub-routines that each pair a goal with a sequence of steps (an observation, the reasoning and the action, with the instance values abstracted away), from successful trajectories, and gives the agent all of them as memory: online, adding the workflows of every execution a success evaluator admits before the next task, or offline, inducing once from a pool of canonical experiences. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

This Skill needs `run_subagent`, so it runs in a top-level Session. If the message only names it, ask which agent to train and on which published Benchmark. Otherwise resolve the inputs below and ask only for a missing Target or Benchmark (or, in `offline` mode, a missing experience pool); everything else has a default.

- `test_agent_id` — the Target (the Evaluation Center's Test Agent): an existing agent of this Project, or `create: <id>` when the user wants a fresh one, created with no plugins by `penguin agent create --agent-id <id> --project-id "$PROJECT_ID" --json` (an id matches `^[a-z][a-z0-9_-]{1,63}$`). If that id exists already, stop and ask; never reinitialize an agent. The Target is never the agent you run as: training rewrites its State while you work.
- `benchmark_id` — a Benchmark of this Project whose `benchmark_config.toml` status is published (not a literal `draft` or `failed`). Its cases (every directory of it holding a `statement/README.md`) are the training stream of `online_train` and the measured case set. Without one, list the published Benchmarks and ask; this Skill never builds one.
- `test_benchmark_id` (optional) — a second published Benchmark held out from training: H1 (the initialized State) and the final memory are measured on it too, and nothing of it reaches the Judge or the Inducer.
- `runs` — runs per case in every measurement; default 1.
- The runtime — the `provider` / `model_id` pair the user names, else your Environment's, fixed for the whole experiment (`references/evaluation.md`, controller step 2). The Judge and the Inducer run on your own model; record it.
- `mode`, fixed before any task evidence is read:
  - `online_train` (default) — the paper's online loop (run, judge, induce, integrate) over the Benchmark's cases as a training stream; the memory is then frozen and measured.
  - `offline` — one induction from a supplied pool of canonical experiences, each a task with its observed trajectory: a folder the user names (annotated or model-synthesized), or the Test Sessions of scoreboard runs that scored 100. Record the pool's provenance. Never make a success out of a failed run, and never switch to an online judge without changing the mode.
- `criteria`, for `online_train` — `autoeval` (default), standing in for the source's neural success evaluator: a Judge that sees only the public task, the trajectory and the outputs; or `gt`, only when the user chooses it: an execution succeeds when it scores 100, never by a tuned partial threshold.

Smoke profile (the default; the paper also makes one pass): `online_train`, one pass over the cases in sorted id order, one execution per case, `criteria: autoeval`, the incremental induction profile (below). Another pass is an extension the user must ask for, never an answer to disappointing scores. A target score or a round limit is not an AWM setting: say so and leave it out.

Budget, for C cases and R runs: `online_train` takes C stream executions of the Target, at most C Judge calls (none with `gt`) and at most C Inducer calls; `offline` takes one Inducer call. Both add `2 × C × R` executions for the H1 and final measurements (plus `2 × C' × R` on a test Benchmark of C' cases). Before the first execution, state the mode and these numbers. Never launch a larger budget implicitly: restate its arithmetic and run it only when the user asks for it.

## Paths and records

Resolve every path from your Environment's `App Data Dir`, as `references/evaluation.md` does; never search for the Project:

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
PENGUIN_HOME = dirname of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = PROJECT_DIR/benchmarks/<benchmark_id>
CASE         = BENCHMARK/<case_id>       # statement/README.md is public; rubric/README.md is private
SCOREBOARD   = BENCHMARK/scoreboard.yaml
SKILL_DIR    = PROJECT_DIR/agents/<your Agent ID>/agent_state/skills/rsi-awm
MEMORY       = STATE/skills/awm-workflows # SKILL.md + workflows.md, the only learned slot
OUT          = <this Session's scratchpad>/rsi-awm/<experiment_id>
```

`<experiment_id>` is `<test_agent_id>-<UTC time as YYYYMMDDTHHMMSSZ>`. Before the first execution, write `OUT/experiment.yaml`; its `dimensions` place the run in the Awesome-RSI taxonomy:

```yaml
method: AWM
paper: "Agent Workflow Memory"
arxiv_url: https://arxiv.org/abs/2409.07429
github_url: https://github.com/zorazrw/agent-workflow-memory
source_revision: 8c0ff8cd11d648c8fceb99e4e42f37e3b75381b1
settings: { mode: online_train, criteria: autoeval, passes: 1, induction: incremental }
pool: <offline only: each experience's task, trajectory and provenance>
test_agent_id: <id>
benchmark_id: <id>
test_benchmark_id: <id or null>
stream_order: [<case ids>]
runs: 1
runtime: { provider: <provider>, model_id: <model_id>, thinking_level: <level> }
roles_model: { provider: <your Provider>, model_id: <your Model ID> }
h1: { version: <n>, sha256: { <every file of STATE but .vault.toml>: <hash> } }
dimensions:
  artifact: workflow memory
  source: successful training trajectories (online_train) or the supplied pool (offline)
  feedback: success Judge (autoeval) or a full score (gt)
  updater: workflow Inducer, appended to the memory
  frequency: per admitted execution (online_train), once (offline)
  topology: sequential stream, one Target
  selection: none, the final memory is kept
  mode: online_train or offline
  scope: the awm-workflows Skill
adaptations: []
```

Keep in OUT every role request and raw reply, every cell result, every published `workflows.md` as `OUT/memory/v<version>.md`, every failure, dropped workflow and adaptation, and `OUT/state.yaml` (next case, phase, State version), so that a compacted or resumed Session continues the run instead of restarting it.

Only the evaluation worker reads a `rubric/`; you, the Judge and the Inducer never do. A Harbor case's session id `harbor:<trial>` names a trial directory under `BENCHMARK/.jobs/<job>/`: its Trace is under `agent/penguin/traces/`, it has no Workspace on this machine, and its `verifier/` output and the tasks' `tests/` and `solution/` are private.

Snapshots: before the first change to a measured State, make sure `TARGET/snapshots/v<version>.tar.gz` exists: an archive of `agent_state/` without `.vault.toml`, its entries rooted at `agent_state/`. Never overwrite one, and stop if it cannot be created. State versions only increase and are never reused.

## Initialize

Follow `references/initialization.md`. It creates the empty workflow memory Skill and one fixed reader line in the Target's `AGENTS.md`, and changes nothing else. The initialized State is H1.

## Measure

Every measurement is a full case × `runs` matrix through `references/evaluation.md`, following its controller section, and lands in that Benchmark's `SCOREBOARD`. Measure H1 first. A prior record is reusable only when its State version, case set, runtime and runs all match. Stream executions are single cells and never enter a scoreboard, and the H1 matrix is never reused as stream executions: later tasks of the stream run on a different memory.

## Induce the workflow memory

The mode decides the path: `online_train` runs the stream below, `offline` the single induction after it; both use the same Inducer and the same Publish step.

### Online training stream

The stream is sequential, one execution at a time, because each task uses the memory learned from those before it; an independent replica would need a separate Target agent. Every execution is one cell through `references/evaluation.md`: the request of its controller step 3 on the current State version, with the pass number as its `run` label, and the result handled as its controller steps 4 and 5 say. After every cell, check that `MEMORY` still matches what you last published; a Target that edits it fails the run's integrity. For each case in the recorded order:

1. **Run.** One cell with the full current memory. Its score is kept for the report only: it never reaches the Judge or the Inducer, and with `autoeval` it never decides admission.
2. **Judge.** With `autoeval`, run the Judge on the execution; its verdict admits the experience or not. With `gt`, a score of 100 admits it, and no Judge runs.
3. **Induce.** For an admitted experience, run the Inducer on it and the current memory.
4. **Integrate** the valid workflows it returns (Publish, below) before the next case. A task that was not admitted, or an Inducer reply of `NONE`, leaves the memory as it is; go on to the end of the stream.

This toolkit runs the paper's incremental profile: induce from the current success and add to the accumulated memory. The release's WebArena pipeline instead re-induces from all accumulated successes, one per intent template; Benchmark cases carry no template ids, so neither emulate that profile nor invent the ids, and never mix the two in one run. AWM has no reflection-driven retry of a failed task, no score gate on the memory and no quota of workflows. An empty memory at the end of the stream is a valid outcome with nothing learned, not a reason to relax admission.

### Offline induction

Run the Inducer once on the whole pool, every experience in one request, as `mind2web/offline_induction.py` does, and publish what it returns. No Judge runs: the pool is canonical already. Keep the pool list, the exact request and the raw reply in OUT. If the pool does not fit in one context, stop, or declare a chunked variant when the user asks for one; never summarize or sample the pool by test performance. A pool drawn from the measured Benchmark's own cases turns the final score into a training-set score: say so, or measure on `test_benchmark_id`.

### Judge

Run one with `run_subagent` per execution (omit `agent_id`), each in a fresh context:

```text
Read <SKILL_DIR>/SKILL.md, section "Judge", and act as the AWM success evaluator. Reply with the JSON only.
statement: <CASE/statement/README.md>
execution: session <session_id>
trace: <its root Trace files, TARGET/traces/*/<session_id>_*.jsonl, or the Harbor trial's>
```

As the Judge, read only these inputs and the Workspace the Trace's `session_meta` names: never a `rubric/`, a gold answer, the score, another case or OUT. Decide from the actual actions, observations and outputs whether the execution completed the task the statement sets. Reply `{"reasoning": "…", "success": true | false}`. When the evidence does not show success, the answer is `false`, however well-formed the output looks.

### Inducer

```text
Read <SKILL_DIR>/SKILL.md, section "Inducer", and act as the AWM workflow inducer. Reply with the workflows only.
memory: <MEMORY/workflows.md>
format: <SKILL_DIR>/references/initialization.md, step 4
experiences: <for each: its task (statement path, or the pool's file) and its trajectory (session id and root Trace files, or the pool's file)>
```

As the Inducer, read only these inputs and the Workspaces the Traces' `session_meta` name. Extract the common, reusable sub-routines the experiences actually carried out, each as a `##` section in the `workflows.md` format: when it applies, its `{parameters}`, and at least two steps, each an observation, the reasoning and the action, with every instance value (names, ids, paths, dates, numbers) replaced by a `{parameter}`. Describe only steps the Trace shows succeeding: never an assumption, an unverified step or an answer. Repeat no workflow the memory holds, and let no two of yours overlap. Reply with the new workflows only, or `NONE`.

### Publish

Only you write `MEMORY`, and only while no cell runs. Check the form of each workflow returned (a `##` heading, an `Applies when` line, at least two numbered steps, no case id) and drop a malformed one whole, recording it; never rewrite a workflow. Append the rest to `workflows.md`. Then bump the `awm-workflows` Skill's `version` (the next `N` when it carries today's date, else today's `.1`) and the State `version` in `STATE/system_config.yaml` by 1, replacing the field rather than adding a second one; parse both files back, and copy `workflows.md` to `OUT/memory/v<version>.md`. A reply that adds nothing publishes nothing.

There is no cap on the number or length of workflows, since the paper gives the agent its whole memory. When the memory outgrows what the Target can read in its context, stop at the last published State rather than truncate it.

### Stops

Stop when the budget is spent, on `version_changed` or `benchmark_invalid`, on an `evaluation_failed` with no repair left, on a runtime mismatch, on a Target edit to `MEMORY`, and when private scoring material or a score enters the Judge's or the Inducer's context (discard that verdict or induction as contaminated). The last published State stays; never publish a partial or contaminated change, and say what stopped the run.

## Freeze and report

After the stream or the induction, the memory is frozen: no Judge, induction or memory write while measuring. The live State is the final memory, and AWM keeps it whatever it scores; a training score never selects a version. Make sure its snapshot exists, then measure it on `benchmark_id`, and on `test_benchmark_id` when given, with a `summary_title` such as `AWM online_train · final memory, 6 workflows · 64.00`. After an early stop, measure the last published State only when the user asks, and name the stop in its summary. Keep every snapshot, record and OUT file; the user can bring H1 back from its snapshot.

Report:

- the mode, `criteria` and profile, and for `offline` the pool with its provenance;
- the H1 and final State versions, the initial and final `workflows.md` with their SHA-256 hashes, and the workflows each admitted experience added;
- the baseline and final scores per Benchmark, and per case;
- for `online_train`, the stream case by case (verdict, score, workflows added), kept apart from the frozen matrices, and its average score, which is the paper's online metric on these cases; the workflows the Traces show the Target following (a read is not a use, and a use is not a gain);
- the budget used against the plan, and every stop, skip or dropped workflow;
- the cost of every role: the Target cells' costs from the worker results, and the usage the Judge and Inducer Sessions recorded;
- the source links and revision, and every adaptation: the memory is a target-owned Skill read through a fixed `AGENTS.md` line, not text added to the system message; the tasks are agent tasks with tools, not web navigation; the success evaluator is an agent Judge, not the source's autoeval prompts and models; `online_train` runs the online loop on a training stream and freezes the memory before measuring, where the paper learns on the test queries themselves and reports that stream; training and measurement share `benchmark_id` unless `test_benchmark_id` was given. This is not a reproduction of the paper's WebArena or Mind2Web numbers;
- that the Evaluation Center's chart shows the curve under the label `<agent_id> · <model_id> · <thinking_level>`.
