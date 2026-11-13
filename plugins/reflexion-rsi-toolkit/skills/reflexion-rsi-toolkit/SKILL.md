---
name: reflexion-rsi-toolkit
description: >-
  Reproduce Reflexion (verbal reinforcement learning, Shinn et al. 2023) on an agent and a
  frozen Benchmark, or on the precise-summary demo task shipped with this Skill: after every
  measured trial a Reflector distills the score matrix and the failed cases' public statements
  into one short written reflection, the Target carries the reflection buffer into its next
  trial, and the best-scoring trial is kept.
version: 2026.11.14.1
---

# Reflexion

[Reflexion: Language Agents with Verbal Reinforcement Learning](https://arxiv.org/abs/2303.11366) (Shinn et al., 2023; [paper page](https://reflexion.vercel.app), code at [noahshinn/reflexion](https://github.com/noahshinn/reflexion), reference revision `218cf0ef1df84b05ce379dd4a8e47f17766733a0`). Reflexion improves an actor without touching weights: the actor attempts the task, an evaluator scores the attempt, a self-reflection model turns the result into short written advice, and the advice enters an episodic memory buffer the actor reads before its next attempt. Model weights, tools and the rest of the Target's harness stay fixed; only the reflection buffer grows, and the best-scoring trial is kept. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

This Skill is the experiment's controller and needs `run_subagent`; if that tool is missing you are a subagent: stop and say the Skill needs a top-level Session. If the request only names this Skill, ask for the Target and the Benchmark, and offer the demo task. Otherwise resolve the inputs below, asking only for one the method needs and the request does not give:

- `test_agent_id`: the Target, an existing Agent of this Project, or `create: <id>` for a fresh one. Never the Agent running this Skill: its workers are this Agent.
- `benchmark_id`: a published Benchmark of this Project; its cases are the trials' task set. When the user asks for the demo task, build it from `references/demo-task.md` first: it fixes the Target, the Benchmark and the budget.
- `case_ids`: every case unless the user names a subset. `runs`: Runs per Case, 1 unless given. A request's `test_repetitions` (the Evaluation Center sends one) gives this count: R runs per case are R complete passes over the Benchmark.
- The Target's runtime, fixed as `references/evaluation.md` says. The Reflector is this Session's model.
- The method's parameters, with the paper's practice:

| Parameter | Source | Smoke profile (the default) |
| --- | --- | --- |
| Trials (N) | the paper varies N by environment; its HumanEval results report pass@1 80.1 → 91.0 with GPT-4 | 2 |
| Buffer size (K) | the paper keeps recent reflections in an episodic memory buffer | 3 |
| Reflection length | short and structured | at most 6 bullets |
| Early stop | none in the source | stop at a complete 100.00 matrix |
| Reflector sampling | the providers' defaults (Penguin sets no temperature) | the same; record it |

The smoke profile applies unless the user sets parameters. A target score or a round limit is not a Reflexion parameter: report against one if given, but never stop or skip on it except the early stop above.

## Paths and records

The paths of `references/evaluation.md`, from the Environment's `App Data Dir`, plus the snapshots and this experiment's output directory in this Session's scratchpad (`<agent_id>` and `<session_id>` are your own):

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
PENGUIN_HOME = dirname of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = PROJECT_DIR/benchmarks/<benchmark_id>
SCOREBOARD   = BENCHMARK/scoreboard.yaml
SNAPSHOTS    = TARGET/snapshots
OUT          = <app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/reflexion-rsi-toolkit/<experiment_id>/
```

`experiment_id` is `<UTC timestamp>-<test_agent_id>`. Before the first measurement, write `OUT/experiment.yaml`:

```yaml
method: Reflexion
paper: Reflexion: Language Agents with Verbal Reinforcement Learning (Shinn et al., 2023)
arxiv_url: https://arxiv.org/abs/2303.11366
github_url: https://github.com/noahshinn/reflexion
source_revision: 218cf0ef1df84b05ce379dd4a8e47f17766733a0
skill: { name: reflexion-rsi-toolkit, version: <installed version>, sha256: <SKILL.md digest> }
test_agent_id: <id>
benchmark_id: <id>
case_ids: [<case ids>]
runs: <runs>
runtime: { target: { provider, model_id, thinking_level }, reflector: { provider, model_id } }
parameters: { trials: <N>, buffer_size: <K>, max_bullets: 6 }
state: { initial_version, buffer_sha256, skill_sha256, reader_sha256 }
artifact: skills/reflexion-memory/reflections.md in the Target's Agent State
source: the Benchmark's training cases
feedback: the Reflector sees score matrices, public statements and prior reflections; never a Rubric, a Trace, or an answer that was not authorized
updater: Reflector calls on this Session's model; this Session alone publishes a State
frequency: one reflection per trial, appended to the buffer
topology: episodic buffer (the last K reflections)
selection: highest training score over trials; an exact tie keeps the earliest
mode: offline, training cases only
scope: the Benchmark's task
adaptations: [<each departure and its reason>]
```

Keep in OUT, append-only: every Reflector prompt and raw reply, every parsed reflection with its trial number or the reason it was skipped, every measurement with its cells and Session ids, and every failure.

**Versions and snapshots.** A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

## Initialize

Follow `references/initialization.md`. It creates the Target when asked, adds the reflection slot `skills/reflexion-memory/` with its fixed reader, seeds an empty buffer, and returns the initial version and hashes for `experiment.yaml`.

## Measure

Every trial is measured exactly as opro measures a State: a full matrix, each case in `case_ids` × Runs `1..runs`, dispatched and recorded through `references/evaluation.md` with the fixed runtime. Before the first matrix, snapshot H1 (the initialized State) and take the State digest; before every later trial, the appended buffer is itself the State change that bumps the version, so snapshot and hash the new State before measuring it, and stop if the snapshot cannot be made.

1. Run the matrix. Measure one State at a time; nothing changes the Target while its cells run.
2. Hash again after the matrix. A difference invalidates it: restore the snapshot and stop. The fix is switching memory and hooks off in the Target's `system_config.yaml` (`memory.enabled: false`, `hooks.enabled: false`), which for an existing Target is the user's call.
3. Append the evaluation to `SCOREBOARD` as soon as it verifies, with a `summary_title` such as `Reflexion trial 1 · 74.17` and, from trial 2 on, the buffer's line count and digest as its `summary`.

A measurement's objective is its stored `score`, the mean of the case means on `0..100`.

## Reflect

After trial t (1 ≤ t < N), unless the trial scored a complete 100.00 matrix (early stop): start a **new** `run_subagent` session — the Reflector — with no `agent_id`, `provider`, `model_id` or `thinking_level`, so it runs on this Session's model, and `yield_time_ms: 590000`. Its prompt carries exactly four things: the role block below, the trial's score matrix as recorded (every case, its runs and its mean), the public `statement/README.md` of every case the matrix did not score 100.00 on, and the buffer's current text. Add nothing else: no Rubric, no Trace, no worker output beyond the protocol YAML, no advice of your own.

```text
You are the self-reflection model of Reflexion. A coding agent just attempted a task set
and scored the matrix below. Write ONE reflection the agent will read before its next
attempt: at most 6 bullets, each a strategy-level takeaway about how the agent should
approach this class of task. Name what to do differently, not which case failed or what
its answer was; a bullet that encodes one case's literal answer is objective hacking and
wrong. Use no file, no tool and no guess beyond the matrix, the statements and the prior
reflections you are given. Reply with only the reflection between <REFLECTION> and
</REFLECTION> markers, no other text.
```

Parse the reply: it must be one `<REFLECTION>` block and nothing else; if not, ask the same Reflector to resend, never rerun the trial. Append the block's text to `STATE/skills/reflexion-memory/reflections.md` as a `## Trial <t> (<UTC date>)` section, drop oldest entries beyond K, give the State a new `version` ("Paths and records"), and save the prompt and the raw reply in OUT. A Reflector that fails or returns nothing is a failed reflection: record it; trial t+1 then runs on the unchanged buffer, and the budget is still spent.

The slot's `SKILL.md` body and description stay identical for H1, every trial and any later test; during the experiment only `reflections.md`, the Skill's `version` and the reader line's presence change. Reflector prompts, score matrices and answers never enter the Target outside the buffer.

## Trials

Run N trials. Trial 1 measures H1 without a reflection. Trials 2..N are reflect → measure: each appends one reflection (Reflect) and then measures the new State (Measure). Stop early only on a complete 100.00 matrix. The experiment's deliverable is the best-scoring trial's State — the snapshot `v<N>` of that version — ties keep the earliest.

Restore the best trial's snapshot exactly, at its measured version and never renumbered:

```bash
cd "<TARGET>" && STAGE="$(mktemp -d .restore-XXXXXX)" && tar -xzf "snapshots/v<N>.tar.gz" -C "$STAGE" \
  && { [ ! -e agent_state/.vault.toml ] || cp -p agent_state/.vault.toml "$STAGE/agent_state/"; } \
  && mv agent_state "$STAGE/replaced" && mv "$STAGE/agent_state" agent_state && rm -r "$STAGE"
```

Verify that the State `version` is that trial's and that `reflections.md` matches the buffer digest recorded for it.

If a matrix cannot be completed under `references/evaluation.md`, that trial has no score: record it, and report over the complete trials.

## Report

Report the per-trial scores in order, the number of reflections written (and skipped, with reasons), the best trial with its score and snapshot version, the buffer's final entry count, every declared adaptation, and the cost: Reflector calls with their tokens, and the measurement cells with their worker tokens. The Skill's own declared adaptations: the Reflector reads the score matrix and public statements, not the actor's trajectory (the family's evaluation protocol exports matrices, not traces) — the metric feedback the paper's feedback-signal abstraction allows; a Rubric-scored Benchmark replaces the paper's unit-test evaluator; trial 1 measures the un-reflected base State and the best trial is kept, where the paper stops when the evaluator passes. Do not claim the paper's published HumanEval, AlfWorld or HotpotQA numbers. A run that stops at trial 1 keeps the base State (single measurement); say so.

## Stops

Never edit the Benchmark to make a score possible; a Benchmark that fails `references/evaluation.md`'s published checks stops the run. Never record a score that no complete matrix produced, and never skip a measurement: a failed trial still spends its budget. Never instruct a Reflector to consult a Rubric or a worker's Trace, and never accept a reflection that quotes either: a buffer contaminated by a Rubric or an answer discards the experiment's later trials as contaminated. Numbers come only from `references/evaluation.md`.

## Trying the setup

The demo task in `references/demo-task.md` checks the whole loop end to end: base trial, one reflection, one buffered trial, twelve Target executions and one Reflector call in total. Its Benchmark is the same precise-summary set the other toolkits' demos ship; nothing needs Docker or a GPU.
