---
name: rrsi-rsi-toolkit
description: >-
  Run RRSI (Regularized Recursive Self-Improvement of Agent Harnesses, Xia et al. 2026) on an
  agent and a frozen Benchmark: an annealed edit budget bounds each proposal, a leakage Critic
  screens it before any measurement, a Pruner deletes machinery that stopped earning its place,
  and a noise-adjusted floor plus a token-cost rule select the next harness.
version: 2026.11.12.1
---

# RRSI

[Regularized Recursive Self-Improvement of Agent Harnesses](https://arxiv.org/abs/2609.24972), Xia et al., Google Cloud AI Research, 2026 ([arXiv:2609.24972v2](https://arxiv.org/abs/2609.24972v2), Algorithm 1–2 and the Hyperparameters appendix). GitHub: [google-research/rrsi](https://github.com/google-research/rrsi), verified revision `be50316e1db05914068a973f322770ef08ed7ba1`, chiefly `rrsi/schedule.py` (Equation anneal), `rrsi/propose.py` (the regularized proposer), `rrsi/critic.py` (the leakage screen), `rrsi/selection.py` (Algorithm 2 as pure functions), `rrsi/history.py` (Equations history, yield, prune, explore) and `rrsi/components.py` (the component set K and its structural subset K_str).

RRSI evolves the **harness** of a frozen policy: prompts, control flow, tooling, memory and context management. Every candidate is a bundled set of component-tagged edits measured on the same evolve set, and the loop's risk is that the harness memorises the evolve tasks and its gain vanishes out of distribution. RRSI regularises both ends of one round. The proposer gets a temporally annealed L0 budget `b_t` (early rounds bundle edits, late rounds make one attributable change), plus stall-triggered exploration of never-exercised components and the full edit history with its measured credit. The selector screens every candidate with a Critic before any measurement is spent, then admits it only if it clears a noise-adjusted floor, a token-cost rule and the domain guards. Components whose recent best gain is non-positive are reported back as Pruner deletion targets. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

This Skill is the experiment's controller and needs `run_subagent`; if that tool is missing you are a subagent: stop and say the Skill needs a top-level Session. If the message only names this Skill, ask for the Target and the Benchmark, and offer the demo task in `references/demo-task.md`. Otherwise resolve the inputs below, asking only for one the method needs and the request does not give:

- `test_agent_id`: the Target, an existing Agent of this Project, or `create: <id>` for a fresh one. Never the Agent running this Skill: its workers are this Agent, and the loop rewrites the Target's State while you work.
- `benchmark_id`: a published Benchmark of this Project whose `benchmark_config.toml` status is not a literal `draft` or `failed`. Its cases are RRSI's **evolve set** `D_evolve`.
- `test_benchmark_id` (optional): a published Benchmark held out from evolution. H_0 and the final harness are measured on it, and nothing of it reaches the Analyst, the Proposer or the Critic. Describe it as an in-distribution held-out split or an out-of-distribution Benchmark according to its tasks, not its ID. Without one, report evolve-set results only.
- `case_ids`: every case of the evolve set unless the user names a subset. `k` controls trials per task in both calibration and candidate evaluation. A supplied `runs` is an alias for `k`; resolve conflicting values before starting. `test_repetitions` controls the baseline/final report measurements, not evolution. On a separate held-out Benchmark it defaults to `k`. Without one, an explicit `test_repetitions` requests repeated evolve-set measurements after freezing; label them as evolve-set results, not held-out testing.
- `harness_source` (optional): the target harness's source checkout and starting revision. When available, evolve an isolated source copy together with the Target's Agent State, following `references/initialization.md`. Otherwise use the State-only adaptation. Keep the controller's installation unchanged.
- The Target's runtime, fixed once per experiment as `references/evaluation.md` says. The Analyst, the Proposer and the Critic run on this Session's model.
- The method's parameters, with the values of the source:

| Parameter | Source | Smoke profile (the default) |
| --- | --- | --- |
| `T`: rounds | 20 | 2 |
| `k`: trials per task inside one evaluation | 2 | 1 |
| `m`: candidate harnesses drawn per round | 2 | 1 |
| `b_min` / `b_max`: bounds of the annealed edit budget `b_t` | 1 / 4 | 1 / 2 |
| `w`: stall window of `sigma_t` | 3 | 1 |
| `m_draft`: candidate slots reserved for exploration when stalled | 1 | 1 (the single candidate explores when stalled) |
| `delta`: empirical noise band | calibrated, `z = 2.0` | calibrated the same way; never guessed |
| `beta0` / `beta1`: the token-cost rule | 0.10 / 40.0 | 0.10 / 40.0 |
| `w_s` / `w_c` / `w_n`: the shaped rule inside the noise band | 100 / 15 / 0.5 | 100 / 15 / 0.5 |
| `n_prune`: window of the recent-yield summary `g_t` | 4 | 1 |
| `repair_rounds`: Critic to Proposer repair attempts | 5 | 2 |

The smoke profile applies unless the user sets parameters. The source's budget (20 rounds × 2 candidates × 2 trials over the whole evolve set) is never a default: run it only when the user asks for it, after you state its arithmetic (see "Budget") and they confirm. A target score or a wall-clock limit is not an RRSI parameter: report against one if given, but never let it change the selection.

The Source column is the authors' `RRSIConfig` default, not every domain's experimental profile. For a named paper setting, use its `domains/<domain>/rrsi.json`; otherwise keep the chosen parameters fixed for this run. Also record `invalid_missing_frac` from that configuration (default `0.15`). Read the selected Benchmark's training, evaluation and scoring instructions before choosing its execution unit.

## Paths and records

The paths of `references/evaluation.md`, from the Environment's `App Data Dir`, plus the snapshots and this experiment's output directory in this Session's scratchpad (`<agent_id>` and `<session_id>` are your own):

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
PENGUIN_HOME = dirname of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = PROJECT_DIR/benchmarks/<benchmark_id>
CASE         = BENCHMARK/<case_id>       # statement/README.md is public; rubric/README.md is private
SCOREBOARD   = BENCHMARK/scoreboard.yaml
SKILL_DIR    = PROJECT_DIR/agents/<agent_id>/agent_state/skills/rrsi-rsi-toolkit
SNAPSHOTS    = TARGET/snapshots
OUT          = <app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/rrsi-rsi-toolkit/<experiment_id>/
SOURCE       = <isolated target source checkout, when harness_source is available>
```

`experiment_id` is `<UTC timestamp>-<test_agent_id>`. Before the first measurement, write `OUT/experiment.yaml`:

```yaml
method: RRSI
paper: Regularized Recursive Self-Improvement of Agent Harnesses (Xia et al., 2026)
arxiv_url: https://arxiv.org/abs/2609.24972
github_url: https://github.com/google-research/rrsi
source_revision: be50316e1db05914068a973f322770ef08ed7ba1
skill: { name: rrsi-rsi-toolkit, version: <installed version>, sha256: <SKILL.md digest> }
test_agent_id: <id>
benchmark_id: <id>
test_benchmark_id: <id or null>
case_ids: [<case ids>]
test_repetitions: <report trials per task, or null if no report remeasurement was requested>
runtime: { target: { provider, model_id, thinking_level }, roles: { provider, model_id } }
parameters: { T, k, m, b_min, b_max, w, m_draft, delta, beta0, beta1, w_s, w_c, w_n, n_prune, repair_rounds, invalid_missing_frac }
components: [<the component set K this run declares>]
state: { h0_version, harness_layout, state_sha256 }
artifact: <editable State paths and, in source mode, target source paths>
harness_mode: <state or source>
source: the evolve set's Training cases
feedback: the Analyst sees public statements and Traces; the Critic sees the diff only; no role sees a Rubric
updater: the Proposer on this Session's model; this Session alone commits a candidate
frequency: m candidates per round, all against one incumbent H_t and one history snapshot
topology: population over the edit history (components and their measured credit)
selection: Algorithm 2, noise-adjusted floor plus token-cost rule, argmax of S
mode: offline, evolve set only
scope: the harness components this run declares
adaptations: [<each departure and its reason>]
```

Keep in OUT, append-only: every meta-prompt and raw Proposer reply, every Analyst report, every candidate diff with its Critic verdict and every repair attempt, every measurement with its cells and Session ids, every round's `directives.json` (the `b_t`, `sigma_t`, `T_t`, `U_t`, `E_t` and `B_t` this round used) and every failure. `OUT/history.jsonl` is the edit history `L_t`: one record per edit, in the shape `references/training.md` defines.

Keep `OUT/frontier.json` in the shape the paper's loop keeps: the incumbent's `t`, commit, job, `S` and `C`, plus `S_star` and the trajectory of every round. Its version identifies the State snapshot and the source/build record together. A resumed Session reads it and continues from the round it names instead of restarting.

**Versions and snapshots.** A new State version is one more than the highest of the current `version`, every `SNAPSHOTS/v<N>.tar.gz`, and every version the scoreboard records for the Target; versions only increase, and a measured or abandoned number is never reused. Snapshot each State before you measure it, and stop if the snapshot cannot be made. The archive holds `agent_state/` without its vault, as the Web App's snapshots do; an existing snapshot of the same version is kept, never overwritten:

```bash
cd "<TARGET>" && mkdir -p snapshots && { [ -e "snapshots/v<N>.tar.gz" ] \
  || { tar --exclude=.vault.toml -czf "snapshots/v<N>.tar.gz.tmp" agent_state \
       && mv "snapshots/v<N>.tar.gz.tmp" "snapshots/v<N>.tar.gz"; }; }
```

Hashes are SHA-256 (`sha256sum`, or `shasum -a 256` on macOS). The State digest covers every file but the vault: `cd "<STATE>" && find . -type f ! -name .vault.toml -print0 | LC_ALL=C sort -z | xargs -0 sha256sum | sha256sum`.

For each version, also retain `OUT/versions/v<N>.json`: the State snapshot path and, in source mode, the source revision, candidate diff, build command and absolute CLI entry or install-bundle path. Keep measured builds immutable so restoring a version restores the code that was evaluated as well as its State.

## Initialize

Follow `references/initialization.md`. It declares the component set `K` this run can edit, prepares the State and any source checkout, and creates `H_0`. The policy model, provider, thinking level, Benchmark and verifier stay fixed. Only the declared target harness paths evolve.

Then calibrate the noise band `delta` before the first round, because the floor of Algorithm 2 is meaningless without it:

1. Measure unchanged `H_0` three times on the whole evolve set, each a complete matrix with the same `k` used for candidates. Retain the full-precision per-trial scores and scoring weights.
2. Follow the pinned authors' `rrsi/calibrate.py`: for repeated baseline scores `S_i`, `sd_null = sqrt(2) * sample_sd(S_i)` and `delta = z * sd_null`, with `z = 2.0`. If the repeated estimate is zero, use that implementation's pooled-trial bootstrap fallback. The exact calculation is in `references/training.md` under "Noise calibration". Write the selected estimate, method and source jobs to `OUT/calibration.json`.
3. Reuse the first matrix as `H_0`'s evaluation `S_0`; do not measure it a fourth time for initialization.

Three evaluations are this toolkit's calibration default. Reuse a supplied calibration only when its H_0 State/source/build, `k`, tasks, scoring and runtime match; otherwise recalibrate. Record its source. Equal aggregate scores or a small task set alone do not justify `delta = 0`: use zero only if the upstream fallback also returns zero.

## Measure

Every measurement covers the full matrix, each case in `case_ids` × Runs `1..k`, dispatched and recorded through `references/evaluation.md` with the fixed runtime. Report remeasurements use `test_repetitions` instead. `H_0` is measured first. A prior measurement is reusable only if its State, source/build, cases, scoring, runtime and trial count all match. For each version:

1. Snapshot it, then take the State digest.
2. Run the matrix with that version's recorded build. Measure one version at a time; nothing changes the candidate while its cells run. Source-mode workers use isolated runtime data roots, so a controller's already-running server cannot execute a candidate's tasks.
3. Hash again. A difference (a memory the Target saved, a hook's write) invalidates the matrix: restore the snapshot and stop. The fix is switching that off in the Target's `system_config.yaml` (`memory.enabled: false`, `hooks.enabled: false`), which for an existing Target is the user's call.
4. Append a complete Case-level evaluation to `SCOREBOARD` as `references/evaluation.md` describes, with a `summary_title` such as `RRSI round 2 · variant A · 74.17` and the harness change as its `summary`. Keep grouped execution usage and incomplete matrices with their RRSI decisions in OUT, following the missing-trial rule in `references/training.md`.

Compute `S` and `C` from full-precision trial records in OUT before rounding display scores. `S` uses the Benchmark's declared aggregation, scaled to `0..1`; equal task weights give the mean of the case means. `C` is the mean of known positive policy-token totals (`n_input_tokens + n_output_tokens`) across trials. Do not add cached tokens a second time or substitute dollar cost. If either harness has no usable `C`, set `Delta C = 0` and still apply Algorithm 2, as the authors' `relative_cost_change` does. Record missing usage alongside the measurements.

## Round

Run rounds `t = 0 .. T-1`. Each round is Algorithm 1 then Algorithm 2, and `references/training.md` gives every prompt, the exact arithmetic and the JSON shapes. In summary:

1. **Analyze.** F_t: run the Analyst over the incumbent's own measurement. Rank failure modes, name capability gaps, list the success habits the change must not break, and write one digest per task. It never sees a Rubric.
2. **Directives.** Compute `b_t` from the schedule, `sigma_t` from the trajectory, `T_t`/`U_t` from the history, `E_t` and `B_t` (the Pruner set). Write `OUT/r<t>/directives.json`.
3. **Propose.** Draw `m` candidates, each in its own copy of the editable State and source paths, each with the annealed budget, the edit history `L_t`, the exploration directive and the Pruner targets. The Proposer edits files using Penguin's native tools and returns its edit declaration. A candidate over budget, untagged, or missing its reserved exploration slot is bounced back to the Proposer, never accepted.
4. **Screen.** The Critic reads the diff before any measurement and rejects leakage (task names, entity names, per-task values, expected answers, benchmark-specific branching), degenerate edits, grader gaming, undeclared bundling, runtime memory leakage and unbounded loops. A rejection goes back to the Proposer for at most `repair_rounds` repairs; a candidate that cannot be repaired is recorded without a measurement and never enters `T_t` or `g_t`. Then re-tag every edit from the diff when its declared component has no evidence in it, and check that the reserved exploration slot still holds.
5. **Measure.** Build each screened source candidate, run the liveness check, and evaluate survivors on the whole evolve set using their own build and State.
6. **Select.** Apply Algorithm 2 to every screened candidate: `Delta S = S' - S_t`, `Delta C = (C' - C_t) / C_t`, the floor `S' >= S_star - delta`, then the cost rule, then the domain guards. The winner is the highest `S'` among the admissible; if none is admissible, `H_{t+1} = H_t`. Record every candidate's decision, its per-edit history rows and its attribution scoreboard.
7. **Advance.** Make the winner's State and source/build record the incumbent, update `S_star = max(S_star, S_{t+1})`, and discard only unmeasured temporary files. Retain the artifacts required to restore measured versions.

The Pruner is not a separate pass: `B_t` is computed from the history's recent-yield summary and handed to the next round's Proposer as deletion targets, so removal is itself a measured edit. Never delete accepted machinery outside a round.

**Budget.** For `N` evolve cases, candidate evaluation uses up to `T × m × N × k` Target trials, plus `3 × N × k` for default calibration and up to `T × m` liveness trials. Requested report measurements of H_0 and final add up to `2 × N_report × test_repetitions`, using the held-out set when supplied, otherwise the evolve set. Reuse matching records rather than rerunning them. Repairs and infrastructure retries add their actual usage. State the planned budget before the first measurement.

## Freeze and report

Freeze the incumbent at the end of round `T-1`: the last harness accepted by Algorithm 2, or H_0 if none was accepted. `S_star` is the selection floor's history, not a second final-selection rule. Restore the incumbent's State snapshot exactly, at its measured version and never renumbered:

```bash
cd "<TARGET>" && STAGE="$(mktemp -d .restore-XXXXXX)" && tar -xzf "snapshots/v<W>.tar.gz" -C "$STAGE" \
  && { [ ! -e agent_state/.vault.toml ] || cp -p agent_state/.vault.toml "$STAGE/agent_state/"; } \
  && mv agent_state "$STAGE/replaced" && mv "$STAGE/agent_state" agent_state && rm -r "$STAGE"
```

Verify that the State `version` is W and that every evolved slot matches its hash; in source mode also restore the matching source/build record. Keep every snapshot and every OUT record. If H_0 is still the incumbent, report that no candidate was accepted. Report score and token changes separately for an accepted harness.

If the user named a separate `test_benchmark_id`, measure H_0 and the final incumbent on it only now, with `test_repetitions` trials per task. Otherwise, honor an explicitly supplied `test_repetitions` on the evolve set. Restore each version's build and State in turn, and finish on the final incumbent. These report measurements never change selection; keep evolve-set and held-out results separate. Without either request, report the retained evolve-set measurements.

Report:

- the `H_0` and final State versions, and every evolved slot's before/after hash and text;
- the baseline and final scores on every Benchmark, per case, with `S` and `C`;
- the trajectory: each round's `b_t`, `sigma_t`, candidate count, screened-out candidates with their Critic reasons, `Delta S`, `Delta C`, the decision and the reason string;
- the Pruner's rounds: which components entered `B_t`, what their recent best gain was, and which deletions were accepted;
- the edits that were accepted, by component, with their hypotheses, and the attribution scoreboard's hit rates;
- the calibration: `sd_null`, `z`, `delta` and the jobs behind them;
- the sources: the paper, the GitHub repository and the verified revision;
- the cost of every role as far as it is recorded: the Target runs from the evaluations, the Analyst, Proposer and Critic Sessions from their Traces' usage; say which parts are unknown;
- the adaptations: editable State/source scope, target harness and model, Benchmark metric and aggregation, any domain guards, parameters and budget used, and whether a held-out split was evaluated. Do not claim the published Terminal-Bench 2.1 or SWE-bench Verified numbers;
- where to look: complete Case-level measurements appear in the Evaluation Center under `<agent_id> · <model_id> · <thinking_level>`; OUT retains all measurements and decisions, including grouped usage and missing trials.
