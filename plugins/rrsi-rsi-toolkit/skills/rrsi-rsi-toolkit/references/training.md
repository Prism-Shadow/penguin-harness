# Run the inner RRSI optimization

You are the inner **Optimizer**, launched by the outer experiment Organizer in a dedicated
Penguin Session. Execute the complete RRSI loop here: prepare H_0, calibrate, analyze Traces,
propose and review edits, build and evaluate candidates, select versions, and repeat. Use
`run_subagent` for the Analyst, Proposer, Critic and evaluation workers. If that capability is
unavailable, return the execution problem to the Organizer rather than asking it to perform
algorithm steps itself.

Use the training request's fixed runtimes, parameters and absolute paths. `OUT` belongs to this
experiment, `SKILL_DIR` contains the supplied `references/`, `TARGET` is the Agent being evolved,
`STATE` is its State, and `SOURCE` is its isolated source checkout when available. Resolve
`references/...` paths relative to `SKILL_DIR`. Follow the
Benchmark's training execution contract. Do not read held-out tasks or run the final Test phase;
the Organizer does that after collecting your frozen result. Existing Traces are evidence to
read, never files to rewrite.

Algorithm 1 (proposal side) then Algorithm 2 (selection side), with the exact arithmetic of
`rrsi/schedule.py`, `rrsi/history.py`, `rrsi/components.py`, `rrsi/propose.py`,
`rrsi/critic.py` and `rrsi/selection.py`. This file is the Optimizer's working reference: it
fixes every formula, every prompt and every JSON shape so a round is reproducible.

## Run the training experiment

Follow `references/initialization.md` to initialize the Target and H_0, including its frozen
State snapshot and any source/build record. Keep the Organizer's and Optimizer's installations
unchanged. The policy model, provider, thinking level, Benchmark and verifier stay fixed.

Then calibrate the noise band `delta` before the first round, because the floor of Algorithm 2 is meaningless without it:

1. Measure unchanged `H_0` three times on the whole evolve set, each a complete matrix with the same `k` used for candidates. Retain the full-precision per-trial scores and scoring weights.
2. Follow the pinned authors' `rrsi/calibrate.py`: for repeated baseline scores `S_i`, `sd_null = sqrt(2) * sample_sd(S_i)` and `delta = z * sd_null`, with `z = 2.0`. If the repeated estimate is zero, use that implementation's pooled-trial bootstrap fallback. The exact calculation is under "Noise calibration" below. Write the selected estimate, method and source jobs to `OUT/calibration.json`.
3. Reuse the first matrix as `H_0`'s evaluation `S_0`; do not measure it a fourth time for initialization.

Three evaluations are this toolkit's calibration default. Reuse a supplied calibration only when its H_0 State/source/build, `k`, tasks, scoring and runtime match; otherwise recalibrate. Record its source. Equal aggregate scores or a small task set alone do not justify `delta = 0`: use zero only if the upstream fallback also returns zero.

Keep in OUT, append-only: every meta-prompt and raw Proposer reply, every Analyst report, every candidate diff with its Critic verdict and every repair attempt, every measurement with its cells and Session ids, every round's `directives.json` (the `b_t`, `sigma_t`, `T_t`, `U_t`, `E_t` and `B_t` this round used) and every failure. `OUT/history.jsonl` is the edit history `L_t`: one record per edit, in the shape defined below.

Keep `OUT/frontier.json` in the shape the paper's loop keeps: the incumbent's `t`, commit, job, `S` and `C`, plus `S_star` and the trajectory of every round. Its version identifies the State snapshot and the source/build record together. A resumed Session reads it and continues from the round it names instead of restarting.

Run rounds `t = 0 .. T-1`. Each round is Algorithm 1 then Algorithm 2, with the detailed prompts, arithmetic and JSON shapes below. In summary:

1. **Analyze.** F_t: run the Analyst over the incumbent's own measurement. Rank failure modes, name capability gaps, list the success habits the change must not break, and write one digest per task. It never sees a Rubric.
2. **Directives.** Compute `b_t` from the schedule, `sigma_t` from the trajectory, `T_t`/`U_t` from the history, `E_t` and `B_t` (the Pruner set). Write `OUT/r<t>/directives.json`.
3. **Propose.** Draw `m` candidates, each in its own copy of the editable State and source paths, each with the annealed budget, the edit history `L_t`, the exploration directive and the Pruner targets. The Proposer edits files using Penguin's native tools and returns its edit declaration. A candidate over budget, untagged, or missing its reserved exploration slot is bounced back to the Proposer, never accepted.
4. **Screen.** The Critic reads the diff before any measurement and rejects leakage (task names, entity names, per-task values, expected answers, benchmark-specific branching), degenerate edits, grader gaming, undeclared bundling, runtime memory leakage and unbounded loops. A rejection goes back to the Proposer for at most `repair_rounds` repairs; a candidate that cannot be repaired is recorded without a measurement and never enters `T_t` or `g_t`. Then re-tag every edit from the diff when its declared component has no evidence in it, and check that the reserved exploration slot still holds.
5. **Measure.** Build each screened source candidate, run the liveness check, and evaluate survivors on the whole evolve set using their own build and State.
6. **Select.** Apply Algorithm 2 to every screened candidate: `Delta S = S' - S_t`, `Delta C = (C' - C_t) / C_t`, the floor `S' >= S_star - delta`, then the cost rule, then the domain guards. The winner is the highest `S'` among the admissible; if none is admissible, `H_{t+1} = H_t`. Record every candidate's decision, its per-edit history rows and its attribution scoreboard.
7. **Advance.** Make the winner's State and source/build record the incumbent, update `S_star = max(S_star, S_{t+1})`, and discard only unmeasured temporary files. Retain the artifacts required to restore measured versions.

The Pruner is not a separate pass: `B_t` is computed from the history's recent-yield summary and handed to the next round's Proposer as deletion targets, so removal is itself a measured edit. Never delete accepted machinery outside a round.

## Measure a candidate

Every measurement covers the full matrix, each case in `case_ids` × Runs `1..k`, dispatched and recorded through `references/evaluation.md` with the fixed runtime. `H_0` is measured first. A prior measurement is reusable only if its State, source/build, cases, scoring, runtime and trial count all match. For each version:

1. Snapshot it, then take the State digest.
2. Run the matrix with that version's recorded build. Measure one version at a time; nothing changes the candidate while its cells run. Source-mode workers use isolated runtime data roots, so an Organizer or Optimizer server cannot execute a candidate's tasks.
3. Hash again. A difference (a memory the Target saved, a hook's write) invalidates the matrix: restore the snapshot and stop. The fix is switching that off in the Target's `system_config.yaml` (`memory.enabled: false`, `hooks.enabled: false`), which for an existing Target is the user's call.
4. Append a complete Case-level evaluation to `SCOREBOARD` as `references/evaluation.md` describes, with a `summary_title` such as `RRSI round 2 · variant A · 74.17` and the harness change as its `summary`. Keep grouped execution usage and incomplete matrices with their RRSI decisions in OUT, following the missing-trial rule below.

Compute `S` and `C` from full-precision trial records in OUT before rounding display scores. `S` uses the Benchmark's declared aggregation, scaled to `0..1`; equal task weights give the mean of the case means. `C` is the mean of known positive policy-token totals (`n_input_tokens + n_output_tokens`) across trials. Do not add cached tokens a second time or substitute dollar cost. If either harness has no usable `C`, set `Delta C = 0` and still apply Algorithm 2, as the authors' `relative_cost_change` does. Record missing usage alongside the measurements.

## Finish training

Freeze the incumbent at the end of round `T-1`: the last harness accepted by Algorithm 2, or H_0 if none was accepted. `S_star` is the selection floor's history, not a second final-selection rule. Restore the incumbent's State snapshot exactly, at its measured version and never renumbered, using the restore procedure in `references/initialization.md`.

Verify that the State version matches the frozen incumbent and that every evolved slot matches its hash; in source mode also restore the matching source/build record. Keep every snapshot and every OUT record. If H_0 is still the incumbent, report that no candidate was accepted. Report score and token changes separately for an accepted harness.

Return whether training completed, the H_0 and final version numbers and their absolute
`OUT/versions/v<N>.json` paths, and the location of the frontier, measurements, decisions and
usage. Include any stop or missing measurements. Do not run held-out evaluation or reinterpret
the final selection for the Organizer.

## The component set K

The source tags every edit with the harness component it modifies, and validates the tag against
the diff. Declare the components available on this Target in `OUT/experiment.yaml` and map their
actual State/source paths during initialization. The table describes the State-only mapping;
source mode also includes the corresponding implementation code, such as the agent loop, context
manager and tool registry:

| Component `l` | In `K_str` | Where it lives on a Target |
| --- | --- | --- |
| `prompt` | no | `STATE/AGENTS.md`, and the body text of the harness slot's `SKILL.md` |
| `control_flow` | no | the harness slot's procedure rules: the ordered steps the Target follows |
| `config` | no | the declared numbers in the harness slot: retry limits, step caps, timeouts |
| `output_plumbing` | no | the harness slot's rules about what the Target writes and how it ends |
| `context_mgmt` | no | the harness slot's rules about what it reads, summarises or drops |
| `client_tool` | yes | a tool the Target registers for itself, as a file the slot instructs it to use |
| `skill` | yes | a nested Skill under the harness slot that the Target loads when the condition fires |
| `memory` | yes | a persisted state file the slot tells the Target to read and write |
| `subagent` | yes | a delegation rule in the slot: when the Target hands work to a subagent |

`K_str = [client_tool, skill, memory, subagent]`. Only these four earn the novelty term
`nu(l')`, because only they add machinery rather than change text or constants.

**Tag recovery.** Keep a declared component only when the diff implements it. For State files,
use the declared path mapping and the mechanism that reads or executes the changed file; a
Markdown procedure is not automatically an engine control-flow change. For source files, use
the `components.normalize` procedure with signals for the target's language and implementation:

1. `text_only(diff)`: every changed line is a string literal or a comment. Then the component is
   `prompt`, whatever the prose says.
2. Otherwise the first match among the domain signals, then the generic ones, wins; no match
   means `prompt`.

```text
domain signal (this toolkit)   pattern
memory                         \bMemory\( | \.remember\( | \.recall\( | _STATE_DIR | memory/
skill                          skills/ | SkillRegistry | skill_use | skill_catalog
client_tool                    ToolRegistry | register_tool | tool_spec | CLIENT_TOOLS
subagent                       \bsubcall\( | sub_agent | subagent
```

A re-tag is logged, never argued: it is what the history records and what the novelty term
counts. It is bounced back to the Proposer only when it breaks a reserved exploration slot.

## Noise calibration

Use the pinned authors' `rrsi/calibrate.py` on repeated unchanged H_0 measurements. Each
measurement uses the candidate evaluation's tasks, scoring weights, runtime and k, and retains
full-precision scores. For R repeated evaluation scores:

```text
sd_null = sqrt(2) * sample_sd(S_1, ..., S_R)       # sample_sd divides by R - 1
delta   = z * sd_null                            # z = 2.0 by default
```

The pairwise differences are diagnostic only, not the samples used by this formula. If there
are fewer than two evaluations or `sd_null == 0`, follow the upstream bootstrap fallback:

1. Pool trial rewards and weights within each task across the baseline evaluations;
   `k_pool = sum(k_per_evaluation)`.
2. With `random.Random(7)`, generate 2,000 bootstrap scores. In each replicate, resample each
   task's pooled trials with replacement, preserving its trial count and reward/weight pairs,
   then compute the weighted score across tasks and trials.
3. `se = population_sd(bootstrap_scores)` and
   `sd_boot = sqrt(2) * se * sqrt(k_pool / k)`.
4. Use the positive repeated estimate when available, otherwise `sd_boot`. As upstream does,
   round `z * selected_sd` to six decimals for delta, retaining the source measurements.

Record the chosen method, k, jobs and estimate in `OUT/calibration.json`. Reuse the first
baseline matrix as S_0; pooling for calibration does not replace S_0 with the mean of the jobs.
Identical aggregate scores can still have nonzero within-task variation, so do not bypass the
bootstrap simply because every S_i is equal.

## The annealed budget b_t

`rrsi/schedule.py`, Equation (anneal):

```text
b_t = ceil( b_min + (b_max - b_min) * 1/2 * (1 + cos(pi * t / T)) ),  t = 0..T-1
```

Compute it in Python, not by eye, so floating error at `t = T` cannot round 1.0000000002 up to 2:

```bash
python3 -c "import math,sys; t=int(sys.argv[1]); T=int(sys.argv[2]); bmin=int(sys.argv[3]); bmax=int(sys.argv[4]); v=bmin+(bmax-bmin)*0.5*(1.0+math.cos(math.pi*t/T)); print(int(math.ceil(round(v,9))))" \
  <t> <T> <b_min> <b_max>
```

`b_t` bounds `||z_t||_0` only: how many independent edits one candidate may carry. It never
restricts the mechanisms the harness may eventually contain.

## The history L_t and its three summaries

`rrsi/history.py`. One JSONL record per **edit**, appended to `OUT/history.jsonl`:

```json
{"t": 0, "variant": "A", "edit_id": "C1", "component": "context_mgmt",
 "hypothesis": "one sentence: the mechanism and why it should move the score",
 "targets_mode": "the failure mode or habit it targets",
 "predicted_affected": ["case-3", "case-7"],
 "diff": "<the candidate's diff, once>", "delta_S": 0.031, "delta_C": -0.082,
 "accepted": true, "outcome": "ACCEPTED", "S": 0.641, "C": 2104.5,
 "bundle": 1, "detail": "admissible: ...", "ts": "2026-11-11 09:00:00"}
```

`outcome` is `ACCEPTED`, `REJECTED` or `LOST` for a measured candidate, `BASELINE` for `H_0`,
and the gate name (`critic_reject`, `smoke_fail`, `eval_invalid`, `no_proposal`) for one dropped
before measurement. A dropped candidate carries `delta_S: null` and **never** enters `T_t` or
`g_t`; it is negative evidence for the Proposer, not a zero score. A bundle's edits all carry the
bundle's one measurement. Only records with a `component` in `K` and a non-null `delta_S` are
"measured".

Then, for round `t`:

```text
T_t     = { l : some measured edit has component l }                    (tried)
U_t     = K \ T_t                                                       (never exercised)
sigma_t = 1[ S_t - S_{t-w} <= delta ],  0 while fewer than w rounds exist
g_t(l)  = max{ Delta S_i : l_i = l, t - t_i <= n_prune },  max(empty) = -inf   (yield)
B_t     = { l in T_t : g_t(l) <= 0 }                                   (the Pruner set)
```

For each `l` in `B_t`, `B_t`'s entry also carries the accepted machinery to remove:

```json
{"component": "memory", "recent_best_gain": -0.004,
 "accepted_edits_in_incumbent": [{"t": 1, "edit_id": "C2", "hypothesis": "prune: ...", "delta_S": 0.021}]}
```

A component outside `B_t` still earns its place because its recent best measured gain was
strictly positive; a component inside it has stopped earning it and is reported as a deletion
target. This is the Lasso-style structural pruning of the paper: removal is proposed, measured
and selected like any other edit, never executed outside a measured candidate.

`nu(l')` for a candidate: the number of **distinct** structural components (`K_str`) among its
edits on which the incumbent has never had an accepted edit. It contributes to the shaped
acceptance rule inside the noise band.

## Stall and exploration E_t

`rrsi/history.py`, `stall_flag` and `exploration`:

```text
untried = [l for l in K if l not in T_t]
if sigma_t == 1 and untried:
    E_t = "STALL: the incumbent has not moved by more than the noise band over the last
           rounds. <m_draft> candidate slot(s) this round are RESERVED for exploratory
           edits on components the run has never exercised: <untried>."
elif untried:
    E_t = "Components not yet exercised in this run: <untried>. Not mandatory this round
           (sigma_t = 0), but evidence about them is still missing."
else:
    E_t = "Every component in K has been exercised at least once."
```

A variant holds a reserved slot when `sigma_t == 1` and `untried` is non-empty and its index
`v >= m - m_draft`. A slot-holding variant must put at least one edit on a component in
`untried`, **judged by the diff after re-tagging**, or the candidate is rejected. With `m = 1`
the single variant holds the slot whenever the run is stalled.

## Sampling m candidates

Each variant A, B, C… works under `OUT/r<t>/<variant>/harness/`, with its own copy of the
incumbent's editable State files and, in source mode, its own source checkout. Every variant sees
the same incumbent, history snapshot and Analyst report; no variant sees another's text, score
or edits. Each is measured on the full evolve set with k trials per task.

Only declared target harness paths enter the diff. Keep credentials, runtime task data, the
Organizer's and Optimizer's State and Benchmark/verifier files out of the candidate copy. Render the incumbent's
training Traces separately as read-only evidence for the Proposer.

## The Proposer

`rrsi/propose.py`. One subagent per variant (`run_subagent`, no `agent_id`, parallel across
variants), at most 40 turns per drafting attempt. Send it `references/proposer.md` and the payload
below, with the absolute candidate directory and rendered training-Trace paths. The subagent
uses Penguin's native file and shell tools to make edits, then returns one JSON `done` record.
The upstream Python controller's JSON action dispatcher is replaced by those native tools;
emitting an `edit_file` JSON object alone does not change a file.

```text
=== THIS VARIANT'S BRIEF ===
You are variant <A> of round <t>. <m> variants are drafted independently from the same
incumbent this round and each is evaluated on the full evolve set; the best admissible one
becomes H_<t+1>.

=== EDIT HISTORY L_t (every measured edit: component, hypothesis, Delta S, Delta C, accepted).
A rejected mechanism is negative evidence; do not redraw it unchanged. An accepted one carries
the gain it produced; refine what has known credit, not what merely preceded a rise. ===
<OUT/history.jsonl rows, most recent last, at most 40, and at most 4 unmeasured ones>

=== ATTRIBUTION SCOREBOARD (how past edits' predictions fared; unpredicted_regressions are
tasks an edit likely broke) ===
<OUT/attribution.jsonl rows, last 20>

=== EXPLORATION DIRECTIVES E_t ===
<E_t, plus the reserved-slot paragraph when this variant holds one>

=== COMPONENTS TO PRUNE B_t (exercised, no strictly improving edit in the recent window;
remove the accepted machinery listed, it has stopped earning its place) ===
<B_t as JSON, or "(none)">

=== THREE-LENS ANALYSIS REPORT F_t (failure modes ranked; capability gaps often need
tool/plumbing fixes; success_habits are behaviors your change MUST NOT break) ===
<OUT/r<t>/analysis_report.json>

=== PER-TASK DIGESTS (evidence anchors; read the supplied Trace files for raw evidence) ===
<OUT/r<t>/digests.json>

=== WORKING COPY AND READ-ONLY TRACE FILES ===
<absolute candidate directory, editable paths, and rendered training-Trace index>

=== CURRENT HARNESS SOURCE H_t ===
<every file of this variant's harness copy, with its path>

=== THIS ROUND'S EDIT BUDGET b_t ===
You may ship AT MOST <b_t> independent edit(s) in this candidate (the budget anneals over the
run: early rounds explore, late rounds make single attributable changes). Ship fewer if the
evidence supports fewer.

=== TASK ===
Address the highest-impact failure modes / capability gaps within your edit budget. Make the
edits with your available tools, then return the done JSON with the edits array.
```

On a repair round, append instead:

```text
=== REVIEWER OBJECTIONS ===
<the Critic's {"reasons": [...], "risk_notes": [...]} and the Proposer's own declared edits>

REPAIR ROUND: your previous edits are already in the working tree (reflected in CURRENT HARNESS
SOURCE above). Fix ONLY what the objections require (remove leaked content, split or re-declare
edits, wire up dead code, or delete the offending part) with minimal additional edits, then
return done again with the corrected edits array.
```

The protocol the Proposer follows is `references/proposer.md`. Its `done` submission is validated
here, not trusted: an empty edit list after real file changes, an edit count over `b_t`, a
missing `id`/`component`/`hypothesis`/`targets_mode`/`predicted_affected`/`retroactive_check`, a
component outside `K`, or a slot-holding variant with no edit on `untried` is bounced back with
the specific problem, and the Proposer must call `done` again. There is no abort: a candidate
that ships nothing tests nothing.

## The Critic

`rrsi/critic.py`. Deterministic pre-checks first, on the diff: a credential pattern, plus this
domain's own patterns — the private material's paths and the evaluation scaffolding that a
harness has no business naming:

```text
rubric/ | scoreboard\.yaml | \.jobs/ | verifier/ | \bgold\b | expected_output | reference_answer
```

Then one LLM review of intent and content, not style, with `references/critic.md` as its
instructions and this payload:

```text
CANDIDATE SUMMARY: <the candidate's summary>
TARGETS: <its targets_mode>

=== DECLARED EDITS (independent changes in this candidate) ===
<the edits array as JSON>

=== DIFF ===
<the candidate's diff, new files included>

=== STATE FILES (if a mechanism persists state) ===
<every file the candidate added under a state or memory path, or "" >
```

The Critic returns strict JSON `{"verdict": "accept" | "reject", "reasons": [...],
"risk_notes": [...]}`. Parse it three times before giving up, and treat an unparseable verdict as
a rejection with the parse failure as its reason. On `reject`, the objections go back to the
Proposer for at most `repair_rounds` repairs; when the repairs are spent, the candidate is
recorded with `outcome: "critic_reject"`, `delta_S: null`, and its diff kept in
`OUT/r<t>/<variant>/diff.patch`.

The Critic never speculates about runtime correctness: undefined names, crashes and syntax are
the smoke check's job, and it only sees the diff.

## Liveness smoke

Before a candidate is measured, it must run at all. Build a source candidate with the recorded
recipe and bind the resulting entry/bundle and State snapshot to its version record. Then run
one evolve case through `references/evaluation.md` with that record and require `status: ok`.
A build, binding or launch failure is `smoke_fail`, recorded without a measurement. A wrong or
malformed answer is scored behavior. The liveness trial is separate from the k-trial matrix;
record its usage separately. Follow the Benchmark's execution unit if it groups tasks.

## Algorithm 2: selection

`rrsi/selection.py`, as pure arithmetic per candidate:

```text
Delta S = S' - S_t
Delta C = (C' - C_t) / C_t if both C' and C_t are known and positive, otherwise 0

floor       : S' >= S_star - delta                                  else reject
cost rule   : if Delta S > delta:
                  accept iff Delta C <= beta0 + beta1 * Delta S
              else:
                  accept iff w_s*Delta S - w_c*Delta C + w_n*nu(l') > 0
guards      : the domain guards below                               else reject
admissible  : floor and cost rule and guards

H_{t+1} = argmax_{H' admissible} S',   or H_t when none is admissible
S_star  = max(S_star, S_{t+1})
```

`S_star` is the best score on the accepted trajectory, so the floor never falls: a candidate below
`S_star - delta` is rejected even when it beats the current incumbent, which is what stops the
run from drifting down inside the noise band. Ties keep the earliest candidate.

The domain guards for this toolkit:

- The candidate must not change the Target's runtime pair; a diff that edits the model, the
  provider or the thinking level is rejected outright, because a score gain from a different
  model is not a harness improvement.
- The candidate may edit its declared State and target source paths. A diff reaching the
  Organizer or Optimizer, credentials, runtime task data, a Rubric or the verifier rejects. The build used
  for measurement must match the candidate's recorded source and State.
- An added mechanism that persists or injects task-specific runtime data is a Critic rejection,
  not a guard: keep it there, so the objection reaches the Proposer's repair.

Write every decision, including the rejected ones, to `OUT/r<t>/decisions.json` with `S`, `C`,
`delta_S`, `delta_C`, `novelty`, `admissible`, `reason` and `guards`.

## Attribution

`rrsi/loop.py`, `Run.attribute`. For every edit of every measured candidate, append to
`OUT/attribution.jsonl`:

```json
{"t": 1, "variant": "A", "edit_id": "C1", "component": "context_mgmt",
 "hypothesis": "…", "n_predicted": 3, "predicted_hit": ["case-3"],
 "hit_rate": 0.33, "unpredicted_regressions": ["case-9"]}
```

A prediction hits when the task's mean rose on the candidate. A regression has
`candidate_mean - incumbent_mean <= -threshold`, where `threshold = domain.regression_threshold(k)`:
`1 / max(1, k)` by default, or `0.05` for the upstream workspace domain. This is independent of
calibration `delta`; record the selected domain threshold. A regression the edit did not predict
is an `unpredicted_regression`. This file is shown back to the next round's Proposer as its
scoreboard, so over-claiming costs it credibility.

## Failure handling

Follow `rrsi/evaluate.py`: a missing trial contributes reward 0 and unknown policy tokens, with
its expected weight still in the full denominator. Never average only the surviving trials.
Record the failure and missing count in OUT. Use the selected configuration's
`invalid_missing_frac` (default `0.15`). A matrix at or below that missing fraction remains
eligible for Algorithm 2. Above it, attempt one infrastructure repair and resume missing trials,
retaining completed results; never duplicate a still-running or completed Target. If the retry
still exceeds the threshold, mark the candidate `eval_invalid`; an invalid baseline stops initialization.
Do not represent an incomplete matrix as a complete Evaluation Center record.

`version_changed`, `benchmark_invalid` and a runtime mismatch stop the run: the last accepted
State/build stays and the report names the stop. Formatting repairs reuse the existing result;
they never rerun the Target.
