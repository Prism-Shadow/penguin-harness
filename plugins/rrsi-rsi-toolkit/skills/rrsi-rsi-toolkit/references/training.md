# One round of RRSI

Algorithm 1 (proposal side) then Algorithm 2 (selection side), with the exact arithmetic of
`rrsi/schedule.py`, `rrsi/history.py`, `rrsi/components.py`, `rrsi/propose.py`,
`rrsi/critic.py` and `rrsi/selection.py`. This file is the controller's working reference: it
fixes every formula, every prompt and every JSON shape so a round is reproducible.
`SKILL_DIR`, `OUT`, `TARGET` and `STATE` are the paths of the Skill's "Paths and records".

## The component set K

The source tags every edit with the harness component it modifies, and validates the tag against
the diff. This run declares the subset of these it can actually edit on a PenguinHarness Target,
and records that subset in `OUT/experiment.yaml`:

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

**Tag recovery.** A declared component is kept only when the diff carries evidence for it;
otherwise it is re-tagged from the diff, exactly as `components.normalize` does:

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
and selected like any other edit, never executed by the controller.

`nu(l')` for a candidate: the number of **distinct** structural components (`K_str`) among its
edits on which the incumbent has never had an accepted edit. It only ever breaks a tie inside
the noise band.

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

Each variant `A`, `B`, `C`… works in its own copy of the harness slots under
`OUT/r<t>/<variant>/harness/`, made by copying the incumbent's slot files. Every variant sees the
same incumbent, the same history snapshot and the same Analyst report; no variant sees another's
text, score or edits. Each is measured on the full evolve set.

Draft the copy with the incumbent's slot files only, never the whole Agent State: the vault,
Traces, workspaces and memory stay out of the diff.

## The Proposer

`rrsi/propose.py`. One subagent per variant (`run_subagent`, no `agent_id`, parallel across
variants), a strict-JSON action protocol, at most 40 turns. Send it `references/proposer.md` as
its instructions and the payload below as its task. It edits the files of its own harness copy,
so give it that absolute path.

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

=== PER-TASK DIGESTS (evidence anchors; use read_trace for raw evidence) ===
<OUT/r<t>/digests.json>

=== CURRENT HARNESS SOURCE H_t ===
<every file of this variant's harness copy, with its path>

=== THIS ROUND'S EDIT BUDGET b_t ===
You may ship AT MOST <b_t> independent edit(s) in this candidate (the budget anneals over the
run: early rounds explore, late rounds make single attributable changes). Ship fewer if the
evidence supports fewer.

=== TASK ===
Address the highest-impact failure modes / capability gaps within your edit budget. Implement
via the JSON actions, then call done with the edits array. First action:
```

On a repair round, append instead:

```text
=== REVIEWER OBJECTIONS ===
<the Critic's {"reasons": [...], "risk_notes": [...]} and the Proposer's own declared edits>

REPAIR ROUND: your previous edits are already in the working tree (reflected in CURRENT HARNESS
SOURCE above). Fix ONLY what the objections require (remove leaked content, split or re-declare
edits, wire up dead code, or delete the offending part) with minimal additional edits, then call
done again with the corrected edits array. First action:
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

Before a candidate is measured, it must run at all. That is not a selection rule, only a gate:
run one case of the evolve set as a single cell through `references/evaluation.md` on the
candidate's State, and require a scored result (`status: ok`). A `version_changed`,
`benchmark_invalid` or launch failure is `smoke_fail`, recorded without a measurement. A wrong
or malformed answer is not a smoke failure: that is the score.

## Algorithm 2: selection

`rrsi/selection.py`, as pure arithmetic per candidate:

```text
Delta S = S' - S_t
Delta C = (C' - C_t) / C_t                      (relative; unknown C means the rule cannot fire)

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

`S_star` is the best score seen **so far**, so the floor never falls: a candidate below
`S_star - delta` is rejected even when it beats the current incumbent, which is what stops the
run from drifting down inside the noise band. Ties keep the earliest candidate.

The domain guards for this toolkit:

- The candidate must not change the Target's runtime pair; a diff that edits the model, the
  provider or the thinking level is rejected outright, because a score gain from a different
  model is not a harness improvement.
- The candidate must not touch anything outside the declared harness slots. A diff reaching
  the vault, the memory store, the schedules, a Rubric or another Agent rejects.
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

A prediction hits when the task's mean rose on the candidate. A regression is a task whose mean
dropped by at least the domain's regression threshold (`delta`); one that the edit did not
predict is an `unpredicted_regression`. This file is shown back to the next round's Proposer as
its scoreboard, so over-claiming costs it credibility.

## Failure handling

A matrix with a missing cell has no score: never average a partial matrix. Retry a candidate's
evaluation once when the infrastructure lost more than 15% of its expected cells; after a retry
that still fails, the candidate is `eval_invalid` and unmeasured. `version_changed`,
`benchmark_invalid` and a runtime mismatch stop the run: the last accepted State stays and the
report names the stop.
