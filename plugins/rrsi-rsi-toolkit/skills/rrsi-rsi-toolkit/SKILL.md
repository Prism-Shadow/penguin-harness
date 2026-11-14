---
name: rrsi-rsi-toolkit
description: >-
  Organize an RRSI (Regularized Recursive Self-Improvement of Agent Harnesses, Xia et al. 2026)
  experiment with a dedicated optimization Session: an annealed edit budget bounds each proposal, a leakage Critic
  screens it before any measurement, a Pruner deletes machinery that stopped earning its place,
  and a noise-adjusted floor plus a token-cost rule select the next harness.
version: 2026.11.12.2
---

# RRSI

[Regularized Recursive Self-Improvement of Agent Harnesses](https://arxiv.org/abs/2609.24972), Xia et al., Google Cloud AI Research, 2026 ([arXiv:2609.24972v2](https://arxiv.org/abs/2609.24972v2), Algorithm 1–2 and the Hyperparameters appendix). GitHub: [google-research/rrsi](https://github.com/google-research/rrsi), verified revision `be50316e1db05914068a973f322770ef08ed7ba1`, chiefly `rrsi/schedule.py` (Equation anneal), `rrsi/propose.py` (the regularized proposer), `rrsi/critic.py` (the leakage screen), `rrsi/selection.py` (Algorithm 2 as pure functions), `rrsi/history.py` (Equations history, yield, prune, explore) and `rrsi/components.py` (the component set K and its structural subset K_str).

You are the outer experiment **Organizer**. Prepare the environment, launch a dedicated inner
Penguin **Optimizer**, collect its frozen harness, and arrange testing and reporting. The
Optimizer owns calibration, analysis, proposals, review, candidate builds and measurements,
selection and iteration. The **Target** runs the candidate harness on tasks. Keep these three
Agents separate.

RRSI evolves the **harness** of a frozen policy: prompts, control flow, tooling, memory and context management. Every candidate is a bundled set of component-tagged edits measured on the same evolve set, and the loop's risk is that the harness memorises the evolve tasks and its gain vanishes out of distribution. RRSI regularises both ends of one round. The proposer gets a temporally annealed L0 budget `b_t` (early rounds bundle edits, late rounds make one attributable change), plus stall-triggered exploration of never-exercised components and the full edit history with its measured credit. The selector screens every candidate with a Critic before any measurement is spent, then admits it only if it clears a noise-adjusted floor, a token-cost rule and the domain guards. Components whose recent best gain is non-positive are reported back as Pruner deletion targets. Run the method the way the paper does; every departure is a declared adaptation reported at the end.

## Before you start

The Organizer needs `run_subagent` for the frozen baseline/final measurements. Check that it
is available before launching training.

If the message only names this Skill, ask for the Target and the Benchmark, and offer the demo task in `references/demo-task.md`. Otherwise resolve the inputs below, asking only for one the method needs and the request does not give:

- `test_agent_id`: the Target, an existing Agent of this Project, or `create: <id>` for a fresh one. It must differ from both the Organizer and the Optimizer; only the Target's declared harness is evolved.
- `benchmark_id`: a published Benchmark of this Project whose `benchmark_config.toml` status is not a literal `draft` or `failed`. Its cases are RRSI's **evolve set** `D_evolve`.
- `test_benchmark_id` (optional): a published Benchmark held out from evolution. H_0 and the final harness are measured on it, and nothing of it reaches the Analyst, the Proposer or the Critic. Describe it as an in-distribution held-out split or an out-of-distribution Benchmark according to its tasks, not its ID. Without one, report evolve-set results only.
- `case_ids`: every case of the evolve set unless the user names a subset. `k` controls trials per task in both calibration and candidate evaluation. A supplied `runs` is an alias for `k`; resolve conflicting values before starting. `test_repetitions` controls the baseline/final report measurements, not evolution. On a separate held-out Benchmark it defaults to `k`. Without one, an explicit `test_repetitions` requests repeated evolve-set measurements after freezing; label them as evolve-set results, not held-out testing.
- `harness_source` (optional): the target harness's source checkout and starting revision. When available, evolve an isolated source copy together with the Target's Agent State, following `references/initialization.md`. Otherwise use the State-only adaptation. Keep the Organizer's and Optimizer's installations unchanged.
- The Target's runtime, fixed once per experiment. Use the provider/model pair requested by the user, otherwise this Session's pair, and the Target's configured thinking level (`medium` when absent). Resolve the Optimizer's runtime separately (this Session's runtime unless requested otherwise); its Analyst, Proposer and Critic inherit it. Pass both runtimes explicitly.
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

The Source column is the authors' `RRSIConfig` default, not every domain's experimental profile. For a named paper setting, use its `domains/<domain>/rrsi.json`; otherwise keep the chosen parameters fixed for this run. Also record `invalid_missing_frac` from that configuration (default `0.15`). Read the selected Benchmark's training, evaluation and scoring instructions before choosing its execution unit. Parameters are fixed before launch; the inner Optimizer applies them throughout training.

## Paths and records

Resolve these paths once from the Organizer's Environment. Pass their absolute values to the
Optimizer and evaluation workers; a new Session must not derive a different OUT from its own
scratchpad. SKILL_DIR below is the copy of the method references prepared for this experiment:

```text
PROJECT_DIR  = <app_data_dir>
PROJECT_ID   = basename of PROJECT_DIR
PENGUIN_HOME = dirname of PROJECT_DIR
TARGET       = PROJECT_DIR/agents/<test_agent_id>
STATE        = TARGET/agent_state
BENCHMARK    = PROJECT_DIR/benchmarks/<benchmark_id>
CASE         = BENCHMARK/<case_id>       # statement/README.md is public; rubric/README.md is private
SCOREBOARD   = BENCHMARK/scoreboard.yaml
SNAPSHOTS    = TARGET/snapshots
OUT          = <app_data_dir>/agents/<agent_id>/scratchpad/<session_id>/rrsi-rsi-toolkit/<experiment_id>/
SKILL_DIR    = OUT/method                  # contains references/
SOURCE       = <isolated target source checkout, when harness_source is available>
```

`experiment_id` is `<UTC timestamp>-<test_agent_id>`. Write `OUT/experiment.yaml`; the Optimizer fills in learned-state and calibration fields during initialization:

```yaml
method: RRSI
paper: Regularized Recursive Self-Improvement of Agent Harnesses (Xia et al., 2026)
arxiv_url: https://arxiv.org/abs/2609.24972
github_url: https://github.com/google-research/rrsi
source_revision: be50316e1db05914068a973f322770ef08ed7ba1
skill: { name: rrsi-rsi-toolkit, version: <installed version>, sha256: <SKILL.md digest> }
test_agent_id: <id>
optimizer_agent_id: <id>
optimizer_session_id: <id, recorded after launch>
benchmark_id: <id>
test_benchmark_id: <id or null>
case_ids: [<case ids>]
test_repetitions: <report trials per task, or null if no report remeasurement was requested>
runtime: { target: { provider, model_id, thinking_level }, optimizer: { provider, model_id, thinking_level } }
parameters: { T, k, m, b_min, b_max, w, m_draft, delta, beta0, beta1, w_s, w_c, w_n, n_prune, repair_rounds, invalid_missing_frac }
components: [<the component set K this run declares>]
state: { h0_version, harness_layout, state_sha256 }
artifact: <editable State paths and, in source mode, target source paths>
harness_mode: <state or source>
source: the evolve set's Training cases
feedback: the Analyst sees public statements and Traces; the Critic sees the diff only; no role sees a Rubric
updater: the inner Optimizer's Proposer; the Optimizer owns candidate commits and selection
frequency: m candidates per round, all against one incumbent H_t and one history snapshot
topology: population over the edit history (components and their measured credit)
selection: Algorithm 2, noise-adjusted floor plus token-cost rule, argmax of S
mode: offline, evolve set only
scope: the harness components this run declares
adaptations: [<each departure and its reason>]
```

## Prepare and launch training

1. Resolve the requested Target, Benchmarks, source revision, runtimes and budget. Prepare the
   Benchmark runner and build dependencies. Use a separate output directory, Optimizer Agent,
   continuing Session and Target per independent experiment. Configure the Optimizer's workspace
   and access policy for the shared experiment paths.
2. Create the Optimizer Agent with Penguin's existing CLI. Copy this toolkit's `references/`
   directory to `OUT/method/references/`. Save a training request in OUT containing the evolve-set
   brief, Target identity/runtime, source location and editable scope, parameters, absolute
   paths and resource limits. Give the Optimizer its absolute path. Keep held-out statements, rubrics and results out of that request.
3. Launch one independent Optimizer Session with `penguin run --background --json`, explicitly
   setting its Project, Agent, workspace, provider, model, thinking level and authorized
   `--approve` mode. Record that mode; if it requires approvals, the Organizer must monitor and
   handle those requests for the independent Session. Its short message
   should tell it to read the copied `references/training.md` and the training request, complete
   the optimization, and return the frozen H_0/final version records. Do not send it back to
   this Organizer entry point. An ordinary `run_subagent` worker cannot host this loop because
   it cannot spawn the algorithm's workers; the separate CLI Session can.
4. Record the returned Session ID and follow its progress with the supported Session tools.
   The Optimizer runs the entire training loop, including calibration and candidate evaluation.
   The Organizer monitors resource use and handles environment failures; it does not propose
   edits, calculate round directives, select candidates or substitute its own final version.
   Resume the same Optimizer Session and its saved frontier after an interruption.

[Initialization](references/initialization.md) is for the inner Optimizer to prepare H_0.
[Training](references/training.md) is its complete algorithm entry point. Follow the Benchmark's
execution contract for training tasks; keep the Optimizer's history across rounds while task
executions use the environments that contract requires.

**Budget.** For N evolve cases, candidate evaluation uses up to `T × m × N × k` Target trials,
plus `3 × N × k` for default calibration and up to `T × m` liveness trials. Requested report
measurements add up to `2 × N_report × test_repetitions`; use the held-out set when supplied,
otherwise the evolve set. Reuse matching records rather than rerunning them. Repairs and
infrastructure retries add their actual usage. State the planned budget before launching.

## Collect, test and report

Collect the Optimizer's completion status, H_0 and final version records, calibration, trajectory,
decisions and usage. Its final harness is the last accepted incumbent, or H_0 if no candidate
was accepted. Verify that the returned artifacts match its saved frontier; do not rank the
historical candidates again. A stopped training run is reported as incomplete.

After training completes, use [evaluation](references/evaluation.md) to test H_0 and final with
their frozen State and matching builds. The Organizer schedules these tests in fresh task
conversations and environments, following the Benchmark's contract. Test Targets receive the
solving harness, not the Optimizer's history or training instructions. The Optimizer remains
finished; test feedback never reopens training or changes the selected version.

If a separate `test_benchmark_id` was supplied, measure both frozen versions on it with
`test_repetitions` trials per task. Otherwise honor an explicit `test_repetitions` on the evolve
set and label those results accordingly. Without either request, report the retained evolve-set
measurements. Restore each version with the procedure in `references/initialization.md` and
finish with the final version restored. Report evolve-set and held-out measurements separately.

Report:

- the `H_0` and final State versions, and every evolved slot's before/after hash and text;
- the baseline and final scores on every Benchmark, per case, with `S` and `C`;
- the trajectory: each round's `b_t`, `sigma_t`, candidate count, screened-out candidates with their Critic reasons, `Delta S`, `Delta C`, the decision and the reason string;
- the Pruner's rounds: which components entered `B_t`, what their recent best gain was, and which deletions were accepted;
- the edits that were accepted, by component, with their hypotheses, and the attribution scoreboard's hit rates;
- the calibration: `sd_null`, `z`, `delta` and the jobs behind them;
- the sources: the paper, the GitHub repository and the verified revision;
- the cost of every role as far as it is recorded: the Target runs from the evaluations, and the Organizer, Optimizer, Analyst, Proposer and Critic Sessions from their Traces' own usage without double counting children; say which parts are unknown;
- the adaptations: editable State/source scope, target harness and model, Benchmark metric and aggregation, any domain guards, parameters and budget used, and whether a held-out split was evaluated. Do not claim the published Terminal-Bench 2.1 or SWE-bench Verified numbers;
- where to look: complete Case-level measurements appear in the Evaluation Center under `<agent_id> · <model_id> · <thinking_level>`; OUT retains all measurements and decisions, including grouped usage and missing trials.
