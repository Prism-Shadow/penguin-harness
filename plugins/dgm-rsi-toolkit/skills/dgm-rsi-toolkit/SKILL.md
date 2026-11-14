---
name: dgm-rsi-toolkit
description: >-
  Reproduce DGM (Darwin Gödel Machine, Zhang et al. 2025) on an agent and a frozen
  Benchmark, or on the precise-summary demo task shipped with this Skill: keep an archive
  of agent variants, select a parent from it, let a fresh session modify the parent's
  package, measure the child, and admit it when it beats its parent.
version: 2026.11.13.1
---

# DGM

[Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents](https://arxiv.org/abs/2505.22954) (Zhang et al., Sakana AI & Jeff Clune's group, 2025; [paper v3](https://arxiv.org/abs/2505.22954v3), §3 and Appendix C, especially §C.2 and §C.3), reference implementation at [jennyzzt/dgm](https://github.com/jennyzzt/dgm). This Skill is a native reimplementation of the paper's method, not a packaging of that repository: this text is the implementation this Skill verifies against, and the repository is listed as the upstream reference implementation. DGM maintains an archive of coding-agent variants; each generation it selects a parent from the archive, a fresh LLM session — the frozen foundation model — modifies the parent's code, the child is measured on a frozen Benchmark, and a child that beats its parent joins the archive, so that task performance and archive diversity both grow while model weights, thinking level, tools and memory configuration stay fixed. DGM has no Reflector, Curator or textual gradient, so add none. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

This Skill is the experiment's controller and needs `run_subagent`; if that tool is missing you are a subagent: stop and say the Skill needs a top-level Session. If the request only names this Skill, ask for the Target and the Benchmark, and offer the demo task. Otherwise resolve the inputs below, asking only for one the method needs and the request does not give:

- `test_agent_id`: the Target, an existing Agent of this Project, or `create: <id>` for a fresh one. Never the Agent running this Skill: its workers are this Agent, and evolution rewrites the Target's State while you work.
- `benchmark_id`: a published Benchmark of this Project; its cases are the environment the archive is selected on. When the user asks for the demo task, build it from `references/demo-task.md` first: it fixes the Target, the Benchmark and the budget.
- `case_ids`: every case unless the user names a subset. `runs`: Runs per Case, 1 unless given. A request's `test_repetitions` (the Evaluation Center sends one) gives this count: R runs per case are R complete passes over the Benchmark.
- The Target's runtime, fixed as `references/evaluation.md` says. The Modifier — the self-modification sessions — run on this Session's model: the paper's frozen foundation model, the same for every generation.
- The method's parameters, with the paper's budget beside the smoke profile:

| Parameter | Paper | Smoke profile (the default) |
| --- | --- | --- |
| Archive seed (K) | 1 initial coding agent | 1, the initialized Target |
| Generations (S) | 80 in the published SWE-bench run; open-ended, run until the compute budget is spent | 2 |
| Children per generation (P) | 1 | 1 |
| Parent selection | weighted sampling over an eligible set (§C.2), with purely greedy selection as the paper's DGM-Greedy ablation (§A.3) | greedy on odd generations, weighted random on even ones |
| Diversity signal | the code and the archive's structure (children count, §C.2) | behavioral fingerprint: Jaccard distance of case-level pass sets |
| Runs per case (R) | the benchmark's own protocol | 1 |
| Budget | about two benchmarks (SWE-bench, Polyglot) × hundreds of thousands of LLM calls of open-ended exploration — the published SWE-bench run took about two weeks and USD 22,000 (§E.1) — never a default | (1 + S × P) × C × R Target executions and S × P Modifier calls |

The smoke profile applies unless the user sets parameters. The paper's budget is never a default: run it only when the user asks for it, after you state its arithmetic (see "Budget") and they confirm. A target score or a round limit is not a DGM parameter: report against one if given, but never stop or skip on it.

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
SKILL_DIR    = PROJECT_DIR/agents/<your Agent ID>/agent_state/skills/dgm-rsi-toolkit
OUT          = <app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/dgm-rsi-toolkit/<experiment_id>/
```

`experiment_id` is `<UTC timestamp>-<test_agent_id>`. Before the first measurement, write `OUT/experiment.yaml`:

```yaml
method: DGM
paper: Darwin Gödel Machine: Open-Ended Evolution of Self-Improving Agents (Zhang et al., 2025)
arxiv_url: https://arxiv.org/abs/2505.22954
github_url: https://github.com/jennyzzt/dgm
source_revision: this Skill reimplements the paper's method natively; the reference implementation was observed at <40-character commit of its default branch>
skill: { name: dgm-rsi-toolkit, version: <installed version>, sha256: <SKILL.md digest> }
test_agent_id: <id>
benchmark_id: <id>
case_ids: [<case ids>]
runs: <runs>
runtime: { target: { provider, model_id, thinking_level }, modifier: { provider, model_id } }
parameters: { generations, children_per_generation, parent_selection: { odd: greedy, even: weighted }, diversity: fingerprint_jaccard, rng_seed: <generation> }
state: { initial_version, package_sha256, reader_block_sha256 }
archive: OUT/archive.yaml, one entry per variant, admitted or not; the seed is its first entry
artifact: skills/dgm-agent/ (the whole package directory) and the dgm-agent reader block in AGENTS.md
frozen: provider, model_id, thinking_level, builtin tools, memory — STATE/system_config.yaml never changes after Initialize
source: the Benchmark's training cases
feedback: the Modifier sees the parent's package files, its lineage's scores and fingerprints from the archive, and the public statements of failed cases; never a Rubric, never a Trace
updater: the Modifier proposes an edit list; this Session alone writes the Target State and publishes a version
frequency: one parent per generation, one child per parent
topology: archive (every admitted variant may become a parent)
selection: parent selection alternates greedy and weighted random; admission is a complete matrix that strictly beats the parent; the report selects the highest training score
mode: offline, training cases only
scope: the dgm-agent package and its reader block
adaptations: [<each departure and its reason>]
```

Keep in OUT, append-only: every Modifier prompt and raw reply, every parsed edit list with its version or the reason its edits were dropped, every admission decision, every measurement with its cells and Session ids, and every failure — a failed child is data like a scored one.

`OUT/archive.yaml` records the archive itself; append one entry per variant:

```yaml
- variant: <State version>
  parent: <parent State version, null for the seed>
  generation: <0 for the seed>
  parent_selection: <seed | greedy | weighted>
  modifier_session: <Session id, null for the seed>
  change_summary: <the Modifier's own one-line summary, verbatim>
  time: <ISO-8601 UTC>
  admitted: <true | false>
  reason: <why admitted or rejected, the evidence verbatim>
  score: <0..100, two decimals, or null when no complete matrix>
  case_scores: { <case_id>: <score> }   # the fingerprint: the cases at 100.00 form the pass set
```

**Versions and snapshots.** A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`. The package digest covers the package directory the same way: `cd "<STATE>/skills/dgm-agent" && find . -type f -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

## Initialize

Follow `references/initialization.md`. It creates the Target when asked, adds the package slot `skills/dgm-agent/` with its seed files and the marked reader block in `AGENTS.md`, freezes memory, and returns the initial version and hashes for `experiment.yaml`. The initialized State is H1, the archive seed: enter it in `OUT/archive.yaml` as generation 0 once its matrix completes.

## Measure

Every measurement is a full matrix, each case in `case_ids` × Runs `1..runs`, dispatched and recorded through `references/evaluation.md` with the fixed runtime. H1, the initialized State, is measured first. A prior measurement is reusable only if its State (version and hashes), cases, runtime and runs all match. For each State:

1. Snapshot it, then take the State digest.
2. Run the matrix. Measure one State at a time; nothing changes the Target while its cells run.
3. Hash again. A difference (a memory the Target saved, a hook's write) invalidates the matrix: restore the snapshot and stop. The fix is switching that off in the Target's `system_config.yaml` (`memory.enabled: false`, `hooks.enabled: false`), which for an existing Target is the user's call.
4. Append the evaluation to `SCOREBOARD` as soon as it verifies, with a `summary_title` such as `DGM generation 1 · child of v1 · 71.67` and the State version, the parent version and the package digest as its `summary`.

A measurement's objective is its stored `score`, the mean of the case means on `0..100`.

## Evolve

Run S generations. In each generation:

1. **Parent selection.** The candidates are the admitted variants of `OUT/archive.yaml` that have a score, the seed among them. Odd generations select greedily: the candidate with the highest score; an exact tie keeps the earliest. Even generations sample weighted random. Give each candidate the weight `score / 100 + <mean distance>`, where the fingerprint of a candidate is the set of cases its matrix scored `100.00`, the distance between two candidates is the Jaccard distance of their fingerprints, `1 − |A ∩ B| / |A ∪ B|` (`0` when both sets are empty), and the mean runs over the other candidates. Skip candidates already at a perfect score, the paper's eligible set (§C.2); when none remains, select greedily. Draw with `random.Random(<generation>)`: order the candidates by the time they were admitted, normalize the weights, walk that order accumulating them, and take the first candidate whose cumulative share passes `rng.random()`; when every weight is zero, draw uniformly the same way. Record the mode in the child's archive entry.
2. **Self-modification.** Make one `run_subagent` call without `agent_id` — a fresh Session on this Session's model, the frozen foundation model — prompted with:

```text
Read <SKILL_DIR>/SKILL.md, section "Modifier", and act as the self-modifying agent of the Darwin Gödel Machine. Reply with the edit list only.
parent: <parent State version>
package: <every file of STATE/skills/dgm-agent/, each as its path relative to that directory and its full content>
reader_block: <the current text between the dgm-agent markers of STATE/AGENTS.md>
lineage: <from OUT/archive.yaml: this parent's score and case scores, and the score, case scores and change summary of every variant on the path from the seed to it>
failed_cases: <the public statement/README.md of every case this parent's matrix did not score 100.00>
```

   Save the prompt and the raw reply in OUT. There is one Modifier call per generation, and no Modifier sees another's text. Never write an edit yourself: you built the demo Benchmark and have read its Rubric, and the Modifier must not.
3. **Parse and check** the reply's edit list. An edit carries `action: replace | create | delete`, `path: package/<relative path>` or `path: reader`, and, for `replace` and `create`, `content:` with the full new text. Apply every edit that passes its check: a `package/` path that resolves inside `STATE/skills/dgm-agent/` without traversal or symlink escape; a `reader` edit whose content replaces exactly the text between the markers, the markers kept; a `replace` of a file that exists, a `create` of one that does not, a `delete` of one that is not the slot's `SKILL.md`. Drop an edit that fails its check and record the drop verbatim; if no edit survives, the child is a failed proposal, not a zero score. Never rewrite an edit to rescue it. The slot's `SKILL.md` body and description may be replaced, but its frontmatter stays: `name: dgm-agent`, and a `version` you move on (the next `N` of the day, else today's `.1`). An edit list that leaves the package empty but for `SKILL.md` is valid: the matrix will say what it is worth.
4. **Publish and measure the child.** Write the surviving edits, give the State a new `version` ("Paths and records"), snapshot it, and measure as in Measure. The complete valid matrix joins `OUT/archive.yaml` as the child's entry; a failed or incomplete matrix joins it with `score: null` and the reason. A generation whose child is a failed proposal still spends its budget, and nothing is refilled.
5. **Admit.** The child is admitted when its matrix is complete and its score is strictly greater than the parent's recorded score, on the same cases, runtime and runs. A tie or a loss is recorded, not admitted: only admitted variants are candidates for parent selection. Declared adaptation: the paper adds every valid child to the archive and keeps every one selectable as a parent (§3, Algorithm 1), so a losing branch can still be explored later; here a branch continues only through strict improvements.

If a matrix cannot be completed under `references/evaluation.md`, that child has no score: record it, and report over the complete measurements.

### Modifier

You are the self-modifying agent of the Darwin Gödel Machine. You receive the complete code of a coding agent — its package files — and the archive's record of how it and its lineage scored. Propose one concrete modification, the way a developer improves a colleague's code: rewrite, add or delete package files, or re-tune how the reader block directs the agent to its package. Aim at the class of task the cases sample, not at any one case: a change that only helps by encoding a specific case's answer is the objective hacking the paper documents (§5, Appendix H) and is rejected in review.

- Read the role instructions in this Skill's `SKILL.md` and nothing else on disk; work from the data the request carries inline. Write nothing: the reply is your only output.
- Change the agent's code, not the measurement. Never propose a path outside `package/` or `reader`. You are shown no Rubric and no Trace; proposing to consult either is a violation, not a shortcut.
- Small, comprehensible changes compound: the archive keeps what improves its score, and the next generation reads your `summary`.
- Reply with the edit list only, as YAML, no fences:

```yaml
- action: replace | create | delete
  path: package/<file path inside the dgm-agent directory>   # or: reader
  content: <full new content for replace and create; omit for delete>
summary: <one line describing the change>
```

### Stops

Stop the search when the budget is spent, on `version_changed` or `benchmark_invalid`, on an `evaluation_failed` with no repair left, on a runtime mismatch, and when private scoring material or a score has entered a Modifier's context (discard that child as contaminated and record it). The last complete archive stands; never publish a partial or contaminated change, and say what stopped the run. Never edit the Benchmark to make a score possible, never record a score that no complete matrix produced, and never instruct a Modifier to copy a Rubric — a Rubric is private to the evaluation worker.

**Budget.** With K = 1 seed, C cases, R runs, S generations and P children per generation, the search needs at most `(K + S × P) × C × R` Target executions before failed proposals are skipped, one evaluation worker for each, and `S × P` Modifier calls. State these numbers before the first measurement.

## Freeze and report

Select the highest complete training score over the archive — H1 and every admitted variant; on an exact tie the earliest wins, so H1 beats a new variant it ties (training-only selection). Restore the winner's snapshot exactly, at its measured version and never renumbered:

```bash
cd "<TARGET>" && STAGE="$(mktemp -d .restore-XXXXXX)" && tar -xzf "snapshots/v<W>.tar.gz" -C "$STAGE" \
  && { [ ! -e agent_state/.vault.toml ] || cp -p agent_state/.vault.toml "$STAGE/agent_state/"; } \
  && mv agent_state "$STAGE/replaced" && mv "$STAGE/agent_state" agent_state && rm -r "$STAGE"
```

Verify that the State `version` is W and that the package digest is the winner's. Keep every snapshot, every archive entry and every OUT record: the paper's archive is the experiment's traceable lineage, and the losing branches are findings, not waste. If H1 wins, report no improvement. If the user named a separate test Benchmark, measure H1 and the winner on it only now, restoring each snapshot in turn and finishing on the winner; a test score never changes the selection.

Report:

- the archive tree: every variant with its version, parent, generation, selection mode, admission and score, and the parent-selection sequence in order;
- the best variant and its improvement over H1, with versions, State digests and the per-case scores of both;
- the seed package and the winner's package, file by file — the surviving edit lists of the winning lineage are the diff;
- the generations run and the children made, dropped (failed edit checks, failed proposals) and measured;
- the sources: the paper and the reference implementation repository;
- the cost of every role as far as it is recorded: the Target runs from the evaluations, the Modifier Sessions from their Traces' usage; say which parts are unknown;
- the adaptations: the agent's code lives as a Target-owned multi-file package plus a delimited reader block in `AGENTS.md`, not as a Python repository; the frozen foundation model is the fixed runtime of `references/evaluation.md` plus this Session's model as the Modifier, not a frozen checkpoint; parent selection alternates greedy and weighted random, where the paper's release samples by sigmoid-scaled performance and children count and its ablation is purely greedy; the diversity term is the behavioral fingerprint (Jaccard distance of case-level pass sets) instead of code embeddings, drawn with Python's `random`; the Modifier is a fresh subagent Session that returns an edit list this Session applies, not a tool-wielding agent editing a sandboxed copy of itself; the Modifier sees archive scores, fingerprints and the public statements of failed cases, not evaluation logs or Traces; admission is a strict score improvement on the same matrix protocol, and only admitted variants are parent candidates, where the paper keeps every valid child selectable so losing branches stay explorable; the archive lives in OUT and the Target's snapshots rather than the paper's archive storage; the budget actually used. Do not claim the published SWE-bench or Polyglot numbers;
- where to look: the Evaluation Center plots every measurement of this run on the Benchmark under the label `<agent_id> · <model_id> · <thinking_level>`, one point per measured version.
