---
name: rsi-ape
description: Reproduce APE (Large Language Models are Human-Level Prompt Engineers, Zhou et al. 2022) on an agent and a frozen Benchmark, or on the house-style brief demo task shipped with this Skill: induce instructions from input/output examples, measure each one, keep the best.
---

# APE

[Large Language Models are Human-Level Prompt Engineers](https://arxiv.org/abs/2211.01910) (Zhou et al., University of Toronto, Vector Institute and University of Waterloo, 2022; [paper v2](https://arxiv.org/abs/2211.01910v2), §3 and §5.3), code at [keirp/automatic_prompt_engineer](https://github.com/keirp/automatic_prompt_engineer). Verified implementation revision `eac521c79a78965245ce7745dcc9f6b0792c7ec7`: `automatic_prompt_engineer/ape.py`, `generate.py`, `evaluate.py` and `template.py`, `experiments/run_instruction_induction.py` and `experiments/evaluation/instruction_induction/exec_accuracy.py`. This Skill runs **non-iterative forward-generation APE with execution scoring**, the paper's default: a proposer infers candidate instructions from input/output demonstrations in one pass, every candidate is measured on the selection cases, and the best is kept. It implements neither the optional iterative Monte Carlo resampling of §5.3 nor bandit (UCB) allocation nor log-likelihood scoring; the public `simple_ape` helper uses UCB, so never claim that helper's profile. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

This Skill is the experiment's controller and needs `run_subagent`; if that tool is missing you are a subagent: stop and say the Skill needs a top-level Session. If the request only names this Skill, ask for the Target, the Benchmark and the demonstrations, and offer the demo task. Otherwise resolve the inputs below, asking only for one the method needs and the request does not give:

- `test_agent_id`: the Target, an existing Agent of this Project, or `create: <id>` for a fresh one. Never the Agent running this Skill: its workers are this Agent.
- `benchmark_id`: a published Benchmark of this Project; its cases are APE's selection set (the source's `eval_data`). When the user asks for the demo task, build it from `references/demo-task.md` first: it fixes the Target, the Benchmark, the demonstrations and the budget, so ask nothing.
- `case_ids`: every case unless the user names a subset. `runs`: Runs per Case, 1 unless given.
- Demonstrations: the input/output pairs the proposer induces from (the source's `prompt_gen_data`).
  - The demo task ships five.
  - Otherwise ask for a file of pairs, or for explicit permission naming the Cases whose gold answers may serve as outputs; those Cases then leave the selection set. A private answer is not authorized because it exists.
  - Never stand failed Target outputs or scores in for demonstrations: that is not APE. Until you have them, wait: open no Rubric and generate nothing.
  - Keep demonstrations and selection cases apart, declare any overlap, and never use test cases for either.
- The Target's runtime, fixed as `references/evaluation.md` says. The proposer is this Session's model.
- The method's parameters, with the values of `run_instruction_induction.py`:

| Parameter | Source | Smoke profile (the default; also the demo task) |
| --- | --- | --- |
| `num_subsamples` | 3 | 1 |
| `num_demos` | 5 | 5, at most the number of demonstrations |
| `num_prompts_per_subsample` | 30 | 4 |
| Selection examples per candidate | `num_samples` = min(20, the eval set), sampled per prompt | every selection case × `runs` |
| Proposer sampling | `text-davinci-002`, temperature 0.9, top_p 0.9, at most 50 tokens | the provider's defaults (Penguin sets none); record it |

The smoke profile applies unless the user sets parameters. The source's 90 candidates (3 × 30) are never a default: run them only when the user asks, after you state the arithmetic (see "Budget") and they confirm. Rounds, a target score or a round limit are not parameters of non-iterative APE: report against a target if given, but never stop or skip on it.

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
OUT          = <app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/rsi-ape/<experiment_id>/
```

`experiment_id` is `<UTC timestamp>-<test_agent_id>`. Before the first measurement, write `OUT/experiment.yaml`:

```yaml
method: APE
paper: Large Language Models are Human-Level Prompt Engineers (Zhou et al., 2022)
arxiv_url: https://arxiv.org/abs/2211.01910
github_url: https://github.com/keirp/automatic_prompt_engineer
source_revision: eac521c79a78965245ce7745dcc9f6b0792c7ec7
skill: { name: rsi-ape, version: <installed version>, sha256: <SKILL.md digest> }
test_agent_id: <id>
benchmark_id: <id>
case_ids: [<selection case ids>]
runs: <runs>
demonstrations: { source: <where the pairs come from>, ids: [<ids>], permitted_fields: [input, output], overlap: <none, or which> }
runtime: { target: { provider, model_id, thinking_level }, proposer: { provider, model_id } }
parameters: { <every parameter above as used, with the sampling seed> }
state: { initial_version, instruction_sha256, skill_sha256, reader_sha256 }
artifact: skills/ape-instruction/instruction.md in the Target's Agent State
source: the demonstrations (generation) and the Benchmark's cases (selection)
feedback: the proposer sees demonstrations only; scores reach this Session, never the proposer
updater: proposer calls on this Session's model; this Session alone publishes a State
frequency: one generation pass (non-iterative)
topology: a fixed candidate pool
selection: highest selection score, ties by instruction text, both descending; no gate against H1
mode: offline, selection cases only
scope: the Benchmark's task
adaptations: [<each departure and its reason>]
```

Keep in OUT, append-only: every proposer prompt and raw reply with the demonstration ids it used, the candidate pool with each candidate's version or the reason it was rejected, every measurement with its cells and Session ids, and every failure.

**Versions and snapshots.** A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

## Initialize

Follow `references/initialization.md`. It creates the Target when asked, adds the instruction slot `skills/ape-instruction/` with its fixed reader, leaves the instruction empty (or the user's declared baseline), and returns the initial version and hashes for `experiment.yaml`.

## Measure

Every measurement is a full matrix, each case in `case_ids` × Runs `1..runs`, dispatched and recorded through `references/evaluation.md` with the fixed runtime. H1, the initialized State, is measured first. A prior measurement is reusable only if its State (version and hashes), cases, runtime and runs all match. For each State:

1. Snapshot it, then take the State digest.
2. Run the matrix. Measure one State at a time; nothing changes the Target while its cells run.
3. Hash again. A difference (a memory the Target saved, a hook's write) invalidates the matrix: restore the snapshot and stop. The fix is switching that off in the Target's `system_config.yaml` (`memory.enabled: false`, `hooks.enabled: false`), which for an existing Target is the user's call.
4. Append the evaluation to `SCOREBOARD` as soon as it verifies, with a `summary_title` such as `APE candidate 2 of 4 · 91.67` and the instruction text and hash as its `summary`.

A measurement's score is its stored `score`, the mean of the case means on `0..100`, computed by the Benchmark's Rubric from the Target's saved output: never the proposer's judgement or a log probability.

## Generate, measure, select

1. **Baseline.** Measure H1, the empty instruction or the user's declared baseline. It is a diagnostic baseline, not a member of the generated pool, and neither its outputs nor its scores reach the proposer.
2. **Generate once.** For subset i = 1..`num_subsamples`, draw `num_demos` demonstrations without replacement with `random.Random(<seed> + i).sample(<demonstration ids>, num_demos)`, seed 0 unless the user gives one, and record the seed and ids. Fill the forward-generation template of `ape.py` with them in the order drawn; braces mark what you fill in:

```text
I gave a friend an instruction. Based on the instruction they produced the following input-output pairs:

Input: {input}
Output: {output}

{…the subset's other demonstrations, each as Input/Output, one blank line apart…}

The instruction was to
```

   For each subset make `num_prompts_per_subsample` independent proposer calls: `run_subagent` calls without `agent_id`, in parallel, each prompted with `Complete the text below from its text alone: call no tools and read no files. Reply with only the words that finish its last sentence.`, a blank line, then the filled template. Never write or edit a candidate yourself: you built the demo Benchmark and have read its Rubric, and the proposer must not. All generation ends before any candidate is measured.
3. **Pool.** A candidate is a reply, stripped, with a repeated `The instruction was to` removed from its start. Reject an empty reply and record why; add no rewriting stage. Remove exact duplicates as `find_prompts` does, numbering the candidates by first occurrence. No candidate is ever generated from a score.
4. **Measure** every candidate, one at a time, on the same cases, runtime and `runs`: write it to `instruction.md`, move the slot Skill's `version` on (the next `N` of the day, else today's `.1`) and give the State a new `version`, then measure as above.
5. **Select.** Rank by score, then by instruction text, both descending in Python's string order (`sorted(zip(scores, prompts))` reversed, as `exec_accuracy.py` does); the first is the winner. APE has **no strict-improvement gate against H1**: when the winner scores below H1, keep the winner and report the regression. Keeping H1 instead is the user's separate decision.

Failures and refusals:

- If the pool cannot be measured completely, restore H1's snapshot and report the search incomplete.
- With no valid candidate, keep H1 and report that generation failed, never that APE learned an empty instruction.
- Demonstrations and case answers stay out of the learned instruction: a candidate that is an answer lookup table gets no score, and you report it with the evidence.

**Budget.** With N = `num_subsamples` × `num_prompts_per_subsample` proposals, C cases and R runs, the experiment needs at most `(1 + N) × C × R` Target executions including H1, before duplicates are removed, one evaluation worker for each, and N proposer calls. State these numbers before the first measurement.

## Freeze and report

Restore the winner's snapshot exactly, at its measured version and never renumbered:

```bash
cd "<TARGET>" && STAGE="$(mktemp -d .restore-XXXXXX)" && tar -xzf "snapshots/v<W>.tar.gz" -C "$STAGE" \
  && { [ ! -e agent_state/.vault.toml ] || cp -p agent_state/.vault.toml "$STAGE/agent_state/"; } \
  && mv agent_state "$STAGE/replaced" && mv "$STAGE/agent_state" agent_state && rm -r "$STAGE"
```

Verify that the State `version` is W and that `instruction.md` has the winner's hash. Keep every snapshot and every OUT record. If the user named a separate test Benchmark, measure H1 and the winner on it only now, restoring each snapshot in turn and finishing on the winner; testing never selects, regenerates or supplies demonstrations.

Report:

- the initial and the final instruction, each with its hash and version;
- the H1 and winner scores, even on a regression, the per-case scores of both, and every candidate's score;
- the proposals generated, distinct, valid and measured; the demonstrations each subset used; the selection cases and any overlap with the demonstrations;
- the sources: the paper, the GitHub repository and the verified revision;
- the cost of every role as far as it is recorded: the Target runs from the evaluations, the proposer and worker Sessions from their Traces' usage; say which parts are unknown;
- the adaptations: the instruction lives in a Target-owned Skill read before every task rather than in the source's `Instruction: [PROMPT]` evaluation template; a tool-using agent answers instead of a single completion; a Rubric score on the whole selection set replaces execution accuracy on sampled examples, so call it benchmark score; proposals come from fresh subagent Sessions completing the template's last sentence at the provider's sampling defaults; the budget actually used. This small profile is neither the source's likelihood or UCB defaults nor its published results;
- where to look: the Evaluation Center plots every measurement of this run on the Benchmark under the label `<agent_id> · <model_id> · <thinking_level>`, one point per measured version. The scores are on the selection cases, which the proposer never saw; without a test Benchmark, say that no held-out test ran.
