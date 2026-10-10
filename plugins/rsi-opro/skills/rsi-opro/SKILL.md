---
name: rsi-opro
description: Reproduce OPRO (Large Language Models as Optimizers, Yang et al. 2023) on an agent and a frozen Benchmark, or on the precise-summary demo task shipped with this Skill: propose instructions from the scored history, measure each one, keep the best.
---

# OPRO

[Large Language Models as Optimizers](https://arxiv.org/abs/2309.03409) (Yang et al., Google DeepMind, 2023; [paper v3](https://arxiv.org/abs/2309.03409v3), §4–5, especially §4.2 and §5.4), code at [google-deepmind/opro](https://github.com/google-deepmind/opro). Verified implementation revision `a76bdce2cbf6d4a0d1e570a6fcfe17be9c2abdd7`: `opro/optimization/optimize_instructions.py` and `opt_utils.py`. OPRO optimizes one instruction: an optimizer model reads the instructions measured so far with their scores, proposes new ones, every proposal is measured on the training cases, and the highest training score is kept. Model weights, tools and the rest of the Target's harness stay fixed; OPRO has no Reflector, Curator, textual gradient or Trace critique, so add none. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

This Skill is the experiment's controller and needs `run_subagent`; if that tool is missing you are a subagent: stop and say the Skill needs a top-level Session. If the request only names this Skill, ask for the Target and the Benchmark, and offer the demo task. Otherwise resolve the inputs below, asking only for one the method needs and the request does not give:

- `test_agent_id`: the Target, an existing Agent of this Project, or `create: <id>` for a fresh one. Never the Agent running this Skill: its workers are this Agent.
- `benchmark_id`: a published Benchmark of this Project; its cases are OPRO's training set. When the user asks for the demo task, build it from `references/demo-task.md` first: it fixes the Target, the Benchmark and the budget.
- `case_ids`: every case unless the user names a subset. `runs`: Runs per Case, 1 unless given.
- The Target's runtime, fixed as `references/evaluation.md` says. The proposer is this Session's model.
- The method's parameters, with the values of the source script:

| Parameter | Source | Smoke profile (the default) |
| --- | --- | --- |
| `num_search_steps` (S) | 200 | 2 |
| `num_generated_instructions_in_each_step` (P) | 8 | 2; the demo task uses 4 |
| `max_num_instructions` | 20 | 20 |
| `num_score_buckets` | 100 | 100 |
| `old_instruction_score_threshold` | 0.3 with GPT scorers, 0 with text-bison | 0 |
| Exemplars per step, k (`num_few_shot_questions_for_instruction_refinement`) | 3, drawn at random, seeded by the step | 3 |
| `few_shot_qa_pairs` | true: each exemplar carries its training answer | false unless the user supplies or authorizes training outputs |
| `initial_instructions` | `Let's solve the problem.` | the same, unless the user declares a seed |
| Sampling | optimizer temperature 1.0, scorer 0.0 | the providers' defaults (Penguin sets no temperature); record it |

The smoke profile applies unless the user sets parameters. The source's budget (200 steps × 8 proposals) is never a default: run it only when the user asks for it, after you state its arithmetic (see "Budget") and they confirm. A target score or a round limit is not an OPRO parameter: report against one if given, but never stop or skip on it.

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
OUT          = <app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/rsi-opro/<experiment_id>/
```

`experiment_id` is `<UTC timestamp>-<test_agent_id>`. Before the first measurement, write `OUT/experiment.yaml`:

```yaml
method: OPRO
paper: Large Language Models as Optimizers (Yang et al., 2023)
arxiv_url: https://arxiv.org/abs/2309.03409
github_url: https://github.com/google-deepmind/opro
source_revision: a76bdce2cbf6d4a0d1e570a6fcfe17be9c2abdd7
skill: { name: rsi-opro, version: <installed version>, sha256: <SKILL.md digest> }
test_agent_id: <id>
benchmark_id: <id>
case_ids: [<case ids>]
runs: <runs>
runtime: { target: { provider, model_id, thinking_level }, proposer: { provider, model_id } }
parameters: { <every parameter above as used, with the exemplar seeds> }
state: { initial_version, instruction_sha256, skill_sha256, reader_sha256 }
artifact: skills/opro-instruction/instruction.md in the Target's Agent State
source: the Benchmark's training cases
feedback: the proposer sees instructions with their scores and sampled public statements; never a Rubric, a Trace, or an answer that was not authorized
updater: proposer calls on this Session's model; this Session alone publishes a State
frequency: P proposals per step, all against one history snapshot
topology: population (the scored history)
selection: highest training score; an exact tie keeps the earliest
mode: offline, training cases only
scope: the Benchmark's task
adaptations: [<each departure and its reason>]
```

Keep in OUT, append-only: every meta-prompt and raw proposer reply, every parsed instruction with its version or the reason it was skipped, every measurement with its cells and Session ids, and every failure.

**Versions and snapshots.** A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

## Initialize

Follow `references/initialization.md`. It creates the Target when asked, adds the instruction slot `skills/opro-instruction/` with its fixed reader, seeds the instruction, and returns the initial version and hashes for `experiment.yaml`.

## Measure

Every measurement is a full matrix, each case in `case_ids` × Runs `1..runs`, dispatched and recorded through `references/evaluation.md` with the fixed runtime. H1, the initialized State, is measured first. A prior measurement is reusable only if its State (version and hashes), cases, runtime and runs all match. For each State:

1. Snapshot it, then take the State digest.
2. Run the matrix. Measure one State at a time; nothing changes the Target while its cells run.
3. Hash again. A difference (a memory the Target saved, a hook's write) invalidates the matrix: restore the snapshot and stop. The fix is switching that off in the Target's `system_config.yaml` (`memory.enabled: false`, `hooks.enabled: false`), which for an existing Target is the user's call.
4. Append the evaluation to `SCOREBOARD` as soon as it verifies, with a `summary_title` such as `OPRO step 1 · proposal 3 · 74.17` and the instruction text and hash as its `summary`.

A measurement's objective is its stored `score`, the mean of the case means on `0..100`.

## Optimize

Run S steps. In each step:

1. **History.** Take every complete valid measurement of this experiment, H1 and losing candidates included. Sort them by score, ascending and stable (ties keep the order they were measured in), keep the last `max_num_instructions`, then drop those below the threshold. Show each score as an integer rounded the way Python's `round` does: `num_score_buckets` of 100 on a `0..100` score. A valid low score never leaves the record itself.
2. **Exemplars.** Draw k training cases with `random.Random(<step>).sample(sorted(case_ids), k)` (every case when there are fewer) and list them in sorted order. Each is shown by its public `statement/README.md`; with `few_shot_qa_pairs`, its authorized output follows. Never a Rubric.
3. **Meta-prompt.** Build it as `gen_meta_prompt` does for a GPT optimizer with the instruction at the start of the problem (`Q_begin`, without `Q:`/`A:` markers). Braces mark what you fill in; `<INS>` and `</INS>` are literal:

```text
Your task is to generate the instruction <INS>. Below are some previous instructions with their scores. The score ranges from 0 to 100.

text:
{instruction}
score:
{score}

{…one text/score entry per history item, lowest score first…}

Below are some problems.

Problem:
<INS>
{statement text}

Ground truth answer:
{authorized output; this entry only with few_shot_qa_pairs}

{…one Problem entry per exemplar…}

Generate an instruction that is different from all the instructions <INS> above, and has a higher score than all the instructions <INS> above. The instruction should begin with <INS> and end with </INS>. The instruction should be concise, effective, and generally applicable to all problems above.
```

4. **Proposals.** Make P independent proposer calls against this one meta-prompt: P `run_subagent` calls without `agent_id`, in parallel, each prompted with `Answer the prompt below from its text alone: call no tools and read no files. Reply with your answer only.`, a blank line, then the meta-prompt. No proposal sees another's text or score. Never write or edit a proposal yourself: you built the demo Benchmark and have read its Rubric, and the proposer must not. Save every prompt and raw reply.
5. **Parse and filter** as the source does. The instruction is the text between `<INS>` and `</INS>` (from the reply's start, or to its end, when a tag is missing), stripped, with `**` removed and its first letter capitalized. Skip, recording why: an exact duplicate of any instruction proposed or measured earlier in this experiment or in this batch; more than 500 characters; text containing `INS`. An explicit `<INS></INS>` is a valid empty instruction; a reply with no text is a failed proposal, not an empty one. The source's GSM8K digit filter does not apply. Never rewrite a proposal to rescue it.
6. **Measure** the surviving proposals one by one: write the text to `instruction.md`, move the slot Skill's `version` on (the next `N` of the day, else today's `.1`) and give the State a new `version`, then measure as above. Every complete valid measurement joins the next step's history. Duplicates, skips and failed proposals are not zero scores; a step with no valid proposal still spends its budget, and nothing is refilled.

If a matrix cannot be completed under `references/evaluation.md`, that candidate has no score: stop the search there, select among the complete measurements, and report the coverage that is missing.

**Budget.** With K = 1 seed instruction, C cases, R runs, S steps and P proposals, the search needs at most `(K + S × P) × C × R` Target executions before duplicates are skipped, one evaluation worker for each, and `S × P` proposer calls. State these numbers before the first measurement.

## Freeze and report

Select the highest complete training score over H1 and every valid candidate; on an exact tie the earliest wins, so H1 beats a new instruction it ties (training-only selection, §5.4). Restore the winner's snapshot exactly, at its measured version and never renumbered:

```bash
cd "<TARGET>" && STAGE="$(mktemp -d .restore-XXXXXX)" && tar -xzf "snapshots/v<W>.tar.gz" -C "$STAGE" \
  && { [ ! -e agent_state/.vault.toml ] || cp -p agent_state/.vault.toml "$STAGE/agent_state/"; } \
  && mv agent_state "$STAGE/replaced" && mv "$STAGE/agent_state" agent_state && rm -r "$STAGE"
```

Verify that the State `version` is W and that `instruction.md` has the winner's hash. Keep every snapshot and every OUT record. If H1 wins, report no improvement. If the user named a separate test Benchmark, measure H1 and the winner on it only now, restoring each snapshot in turn and finishing on the winner; a test score never changes the selection.

Report:

- the initial and the final instruction, each with its hash and version;
- the baseline (H1) and final scores, the per-case scores of both, and every candidate's score;
- the steps run and the proposals made, skipped (duplicate, too long, `INS`, failed) and measured;
- the sources: the paper, the GitHub repository and the verified revision;
- the cost of every role as far as it is recorded: the Target runs from the evaluations, the proposer and worker Sessions from their Traces' usage; say which parts are unknown;
- the adaptations: the instruction lives in a Target-owned Skill read before every task rather than at the source's `Q_begin`/`Q_end`/`A_begin` position; a Rubric score replaces exact-match accuracy, so call it benchmark-score optimization; exemplars carry no outputs unless authorized; proposals come from fresh subagent Sessions at the providers' sampling defaults; exemplars are drawn with Python's `random` rather than numpy; no periodic validation (`eval_interval`) runs during the search; the budget actually used. Do not claim the published GSM8K or BBH numbers;
- where to look: the Evaluation Center plots every measurement of this run on the Benchmark under the label `<agent_id> · <model_id> · <thinking_level>`, one point per measured version.
