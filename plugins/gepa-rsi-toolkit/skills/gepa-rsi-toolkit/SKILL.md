---
name: gepa-rsi-toolkit
description: Run GEPA (Reflective Prompt Evolution Can Outperform Reinforcement Learning, Agrawal et al. 2025) on an agent and a frozen Benchmark - reflect on a minibatch of its Traces and scores to rewrite the instruction, keep a child that beats its parent, draw parents from the per-case Pareto front, keep the best average.
version: 2026.10.22.1
---

# GEPA

[GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning](https://arxiv.org/abs/2507.19457) (Agrawal et al., 2025; [paper v2](https://arxiv.org/abs/2507.19457v2), §3 with Algorithms 1 and 2, Appendices C and E), code at [gepa-ai/gepa](https://github.com/gepa-ai/gepa). Verified implementation revision `8f287de942f41a6d1e0e7e5b2d576247c4bedee9`: `src/gepa/api.py`, `core/engine.py`, `proposer/reflective_mutation/reflective_mutation.py`, `gepa_utils.py` and `strategies/` (`batch_sampler.py`, `candidate_selector.py`, `acceptance.py`, `instruction_proposal.py`). GEPA evolves one instruction here. Each iteration draws a parent from the candidates that lead on at least one Pareto case, runs it on a minibatch of feedback cases, has a reflection model read those executions and their scores and write a new instruction, and runs the child on the same minibatch; the child joins the pool only when its minibatch total is strictly higher. Every pool member is measured on all Pareto cases, and the best average is kept. This Skill runs `optimize`'s defaults on a system of one module: Pareto candidate selection, a minibatch of 3, strict improvement, no Merge. Model weights, tools and the rest of the Target's harness stay fixed. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

This Skill is the experiment's controller and needs `run_subagent`; if that tool is missing you are a subagent: stop and say the Skill needs a top-level Session. If the request only names this Skill, ask for the Target and the Benchmark. Otherwise resolve the inputs below, asking only for one the method needs and the request does not give:

- `test_agent_id`: the Target, an existing Agent of this Project, or `create: <id>` for a fresh one. Never the Agent running this Skill: its workers are this Agent.
- `benchmark_id`: a published Benchmark of this Project; its cases are GEPA's feedback set (the paper's D_feedback, the source's `trainset`), the only cases whose executions the reflection model reads. Without one, list the published Benchmarks and ask; this Skill never builds one.
- `pareto_benchmark_id`: the Pareto set (D_pareto, the source's `valset`), on which every pool member is measured and the winner is selected. The paper uses a separate validation split (Appendix E.1). Without one, the Pareto set is the feedback set, as `optimize` does when no `valset` is given; say so in the report. The test half of a train/test pair, such as GDPevo's, never serves as either set.
- `feedback_case_ids` and `pareto_case_ids`: every case of their Benchmark unless the user names a subset; two subsets of one Benchmark stay disjoint. `runs`: Runs per Case on the Pareto set, 1 unless given. A minibatch case runs once, as the source evaluates every example once.
- `test_benchmark_id` (optional): a held-out published Benchmark, measured only after selection, for the seed and the winner.
- The seed instruction: the user's declared one, else empty (`references/initialization.md`).
- The Target's runtime, fixed as `references/evaluation.md` says. The reflection model is this Session's model.
- The method's parameters, with P the number of Pareto cases and R = `runs`:

| Parameter | Source | Smoke profile (the default) |
| --- | --- | --- |
| `reflection_minibatch_size` (b) | 3 (Appendix E.4; the `optimize` default) | 3, at most the feedback set |
| `max_metric_calls` (B, Target executions) | set per benchmark, 1839 to 7051 for Qwen3-8B (Table 1), matched to MIPROv2's; no code default | `P × R + 8 × b`: the seed's measurement and four iterations that admit nothing |
| `candidate_selection_strategy` | `pareto` | `pareto` |
| `acceptance_criterion` | `strict_improvement` | `strict_improvement` |
| `skip_perfect_score`, `perfect_score` | true, 1.0 | true, 100 |
| `module_selector` | `round_robin` | the one module, the instruction |
| `use_merge` | false; GEPA+Merge merges at most 5 times (Appendix E.4) | false |
| `seed` | 0 | 0 |
| Sampling | Qwen3-8B at temperature 0.6, top-p 0.95, top-k 20; GPT-4.1-mini at temperature 1.0 (Appendix E.2) | the providers' defaults (Penguin sets none); record it |

The smoke profile applies unless the user sets parameters. A paper-scale budget runs only when the user asks for it, after you state its arithmetic (see "Budget") and they confirm. Merge is not offered: with one instruction, its per-module rule (Appendix D.1) always returns one parent's instruction, so it adds no candidate; decline a request for it and say why. A target score or a round limit is not a GEPA parameter: report against one if given, but never stop or skip on it.

## Paths and records

The paths of `references/evaluation.md`, from the Environment's `App Data Dir`, plus the snapshots and this experiment's output directory in this Session's scratchpad (`<agent_id>` and `<session_id>` are your own):

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
PENGUIN_HOME = dirname of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = PROJECT_DIR/benchmarks/<benchmark_id>         # the feedback set
PARETO       = PROJECT_DIR/benchmarks/<pareto_benchmark_id>  # BENCHMARK when none is given
SCOREBOARD   = PARETO/scoreboard.yaml
SNAPSHOTS    = TARGET/snapshots
OUT          = <app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/gepa-rsi-toolkit/<experiment_id>/
```

`experiment_id` is `<UTC timestamp>-<test_agent_id>`. Before the first measurement, write `OUT/experiment.yaml`:

```yaml
method: GEPA
paper: "GEPA: Reflective Prompt Evolution Can Outperform Reinforcement Learning (Agrawal et al., 2025)"
arxiv_url: https://arxiv.org/abs/2507.19457
github_url: https://github.com/gepa-ai/gepa
source_revision: 8f287de942f41a6d1e0e7e5b2d576247c4bedee9
skill: { name: gepa-rsi-toolkit, version: <installed version>, sha256: <SKILL.md digest> }
test_agent_id: <id>
benchmark_id: <id>
feedback_case_ids: [<case ids>]
pareto_benchmark_id: <id, or the benchmark_id>
pareto_case_ids: [<case ids>]
test_benchmark_id: <id or null>
runs: <runs>
runtime: { target: { provider, model_id, thinking_level }, reflection: { provider, model_id } }
parameters: { <every parameter above as used> }
state: { initial_version, instruction_sha256, skill_sha256, reader_sha256 }
artifact: skills/gepa-instruction/instruction.md in the Target's Agent State
source: the Target's own executions on minibatches of the feedback cases
feedback: each execution's Rubric score, its Trace and its Workspace; never a Rubric or a gold answer
updater: reflection calls on this Session's model; this Session alone publishes a State
frequency: one reflection per iteration, on b executions
topology: a pool with parent links; parents drawn from the per-case Pareto front
selection: admission on a strictly higher minibatch total; the highest Pareto average wins, ties to the earliest
mode: offline
scope: the Benchmark's task
adaptations: [<each departure and its reason>]
```

Keep in OUT, append-only: each iteration's parent, minibatch ids, cells and Session ids, every reflection prompt and raw reply, every rejected child with its version and both minibatch totals, and every failure. Two files are rewritten as the run goes (see "Optimize"): `OUT/pool.json`, the pool, and `OUT/draw.json`, the draws' state.

**Versions and snapshots.** A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

**Restoring a version.** Bring a snapshotted version back exactly, never renumbered:

```bash
cd "<TARGET>" && STAGE="$(mktemp -d .restore-XXXXXX)" && tar -xzf "snapshots/v<N>.tar.gz" -C "$STAGE" \
  && { [ ! -e agent_state/.vault.toml ] || cp -p agent_state/.vault.toml "$STAGE/agent_state/"; } \
  && mv agent_state "$STAGE/replaced" && mv "$STAGE/agent_state" agent_state && rm -r "$STAGE"
```

## Initialize

Follow `references/initialization.md`. It creates the Target when asked, adds the instruction slot `skills/gepa-instruction/` with its fixed reader, writes the seed instruction, and returns the initial version and hashes for `experiment.yaml`. The initialized State is candidate 0, the seed.

## Measure

Two kinds of execution, both through `references/evaluation.md` on the fixed runtime:

- **A Pareto measurement** is a full matrix, each Pareto case × Runs `1..runs`, dispatched and recorded as its controller section says. It is how the seed and every admitted child are scored. A candidate's score on a Pareto case is that case's stored mean, and its average is the stored `score`. Append it to `SCOREBOARD` as soon as it verifies, with a `summary_title` such as `GEPA candidate 3 (parent 1) · 68.33` and the instruction text and hash as its `summary`.
- **A minibatch cell** is one execution of one feedback case: the request of controller step 3 on the current State version, its `benchmark_id` the feedback Benchmark, with a fresh `run` label for each execution of the same case (1, 2, … across the experiment), its result handled as controller steps 4 and 5 say. A minibatch's b cells may run in parallel. Minibatch cells never enter a scoreboard: they are the method's own history and stay in OUT.

For either kind:

1. Snapshot the State, then take the State digest.
2. Run the cells. Measure one State at a time; nothing changes the Target while its cells run.
3. Hash again. A difference (a memory the Target saved, a hook's write) invalidates them: restore the snapshot and stop. The fix is switching that off in the Target's `system_config.yaml` (`memory.enabled: false`, `hooks.enabled: false`), which for an existing Target is the user's call.

Every score is the Benchmark's Rubric applied to the Target's saved output, on `0..100`: never the reflection model's judgement. A prior Pareto measurement is reusable only if its State (version and hashes), cases, runtime and runs all match; a minibatch cell never is.

## Optimize

`scripts/draw.py` in this Skill's directory makes every random choice: one `random.Random(seed)` stream draws each iteration's parent, then its minibatch, in the source's order, and its state survives in `OUT/draw.json` so that a resumed Session continues the stream. It needs only Python 3. Keep `OUT/pool.json` current for it: `seed`, `minibatch_size`, `feedback_case_ids`, `pareto_case_ids` and `members`, one per pool member with its `index`, `version`, `parent`, `instruction_sha256`, `average` and per-case `scores`. Never draw a parent or a minibatch by hand, and never reseed.

**Seed.** Measure candidate 0, the initialized State, on the Pareto set, and write it into `pool.json` as the first member, its parent `null`.

Then run iterations while the Target executions spent are fewer than B:

1. **Draw.** Run `python3 <this Skill's directory>/scripts/draw.py "<OUT>"`. It prints the iteration's parent index and minibatch ids, and appends them to `OUT/draws.jsonl`. The parent comes from Algorithm 2: a Pareto case's front is the members with its highest score (ties share it); members are pruned lowest average first while every front they are in keeps another; the parent is drawn with weight equal to the fronts a survivor is in. The minibatch is the next b ids of the feedback set, reshuffled each epoch and padded to a multiple of b with the least-used ids (`EpochShuffledBatchSampler`). Resuming, take an iteration that already has a line in `draws.jsonl` from there rather than drawing again.
2. **Parent.** If the live State is not the parent's version, restore the parent's snapshot. Run its b minibatch cells. The source runs the parent again on every minibatch, capturing its executions, so never reuse an earlier iteration's cells.
3. **Perfect.** If all b cells score 100, the iteration ends here: its executions are spent and nothing is reflected on.
4. **Reflect.** Make one `run_subagent` call without `agent_id`, prompted with `Read only the files the examples below name, then answer the prompt from them: call no other tools and write no file. Reply with your answer only.`, a blank line, then the source's reflection prompt (Appendix C, `InstructionProposalSignature.default_prompt_template`). Braces mark what you fill in: `{instruction}` is the parent's `instruction.md` as it stands, and `{examples}` one record per minibatch cell, in minibatch order:

````text
I provided an assistant with the following instructions to perform a task for me:
```
{instruction}
```

The following are examples of different task inputs provided to the assistant along with the assistant's response for each of them, and some feedback on how the assistant's response could be better:
```
{examples}
```

Your task is to write a new instruction for the assistant.

Read the inputs carefully and identify the input format and infer detailed task description about the task I wish to solve with the assistant.

Read all the assistant responses and the corresponding feedback. Identify all niche and domain specific factual information about the task and include it in the instruction, as a lot of it may not be available to the assistant in the future. The assistant may have utilized a generalizable strategy to solve the task, if so, include that in the instruction as well.

Provide the new instructions within ``` blocks.
````

   Each record is rendered as `format_samples` renders one, the records separated by blank lines:

```text
# Example {n}
## Inputs
{the case's statement/README.md}

## Generated Outputs
{the absolute paths of the execution's root Trace and of its Workspace}

## Feedback
Score: {the cell's score} / 100
```

   A Workspace case's root Trace is `TARGET/traces/*/<session_id>_*.jsonl`; a Harbor case's is under its trial directory, `BENCHMARK/.jobs/<job>/<trial>/agent/penguin/traces/`, and it has no Workspace on this machine. Never name or quote a `rubric/`, a gold answer, a trial's `verifier/` output, a task's `tests/` or `solution/`, another case, OUT or the pool's scores. Never write or edit an instruction yourself: the reflection model writes it, and this Session has read the Benchmark's files.
5. **Parse** the reply as `ProposalAdapter.parse` does. When it holds two ``` fences or more, the instruction is the text between the first and the last, with its first line removed when that line holds no space (a language tag, or nothing), then stripped. Otherwise it is the whole reply stripped, with a leading fence and its tag removed, else a trailing fence. An empty fenced instruction is a valid one. A reply with no text at all is a failed proposal, where the source would take it as an empty instruction: the iteration ends with no child, recorded with its reason, and the report declares it. Never rewrite a proposal to rescue it.
6. **Child.** On the parent's State, write the instruction to `instruction.md`, move the slot Skill's `version` on (the next `N` of the day, else today's `.1`) and give the State a new `version`. Run the child's b cells on the same minibatch ids.
7. **Admit** as `acceptance.py`'s `strict_improvement` does: the child joins the pool, with the next index and the parent recorded, only when the sum of its b scores is strictly greater than the parent's. Measure an admitted child on the Pareto set at once and add it to `pool.json`. A rejected child keeps its snapshot and its version, which is never reused; it gets no Pareto measurement and is never a parent.

If a cell or a matrix cannot be completed under `references/evaluation.md`, it has no score: stop the search there, select among the complete Pareto measurements, and report the coverage that is missing.

**Budget.** Every Target execution counts toward B, as the source's `total_num_evals` does: `P × R` for the seed and for each admitted child, b for each parent minibatch, b for each child minibatch. B is checked only before an iteration starts, as `MaxMetricCallsStopper` does, so the last iteration can pass it by at most `2b + P × R`. The search therefore needs at most `B + 2b + P × R` Target executions, one evaluation worker for each, and at most one reflection call per iteration. State these numbers before the first measurement.

## Freeze and report

Select the pool member with the highest Pareto average; on an exact tie the earliest wins, as `GEPAResult.best_idx` does, so the seed beats a child it ties. Restore the winner's snapshot (see "Restoring a version"), verify that the State `version` is the winner's and that `instruction.md` has its hash, and keep every snapshot and every OUT record. If the seed wins, report no improvement. If the user named `test_benchmark_id`, measure the seed and the winner on it only now, restoring each snapshot in turn and finishing on the winner; a test score never changes the selection.

Report:

- the seed and the final instruction, each with its hash and version;
- the seed's and the winner's Pareto averages and per-case scores, every pool member's average with its parent, and the test scores when a test Benchmark ran;
- the iterations run: admitted, rejected (with both minibatch totals), ended on a perfect parent, and failed proposals; the Target executions spent against B;
- the sources: the paper, the GitHub repository and the verified revision;
- the cost of every role as far as it is recorded: the Target runs from the evaluations and the cell results, the reflection and worker Sessions from their Traces' usage; say which parts are unknown;
- the adaptations: the instruction lives in a Target-owned Skill read before every task rather than in a DSPy predictor's signature; the system is one tool-using agent with one evolvable module; the feedback function returns the Rubric score as its whole text, since the Rubric is private, so the reflection model reads the Target's Trace and Workspace but no failed Rubric items or evaluator messages; the trajectory reaches the reflection model as file paths it reads, not inlined text; scores are on `0..100`, so `perfect_score` is 100; reflection runs in a fresh subagent Session at the provider's sampling defaults; Merge does not run; the Pareto set is the feedback set unless `pareto_benchmark_id` was given; the budget actually used. Do not claim the paper's HotpotQA, IFBench, HoVer, PUPA, AIME or LiveBench numbers;
- where to look: the Evaluation Center plots every Pareto measurement of this run on the Pareto Benchmark under the label `<agent_id> · <model_id> · <thinking_level>`, one point per admitted version. The selection is made on the Pareto set, so its score is not a held-out one; without a test Benchmark, say that no held-out test ran.
