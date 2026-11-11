# The demo task

A minimal evolve set for the smoke profile: one Target, one Benchmark, two cases, one round of one
candidate. It runs end to end in a few minutes and exercises every mechanism — the annealed budget,
the Critic screen, one measurement, Algorithm 2 — so a user can see the loop work before pointing it
at a real Benchmark. It is a demonstration, not an evaluation: two cases give a noise band of zero
and a score that moves only in visible steps.

## What it builds

- **Target** `rrsi_smoke`: `penguin agent create --agent-id rrsi_smoke --project-id "$PROJECT_ID" --json`, with no plugins.
- **Benchmark** `rrsi-smoke`, published, with two cases of the same kind of work, so a harness
  improvement that generalises shows up in both and a task-specific hack shows up in neither.

Both cases are short writing tasks with a checkable shape, so the Rubric can be objective:

### Case `release-note`

`statement/README.md`:

```markdown
# Release note

Read `changes.md` in this Workspace and write `RELEASE.md`: one release note for the next version.

- `RELEASE.md` starts with a level-one heading holding the version number exactly as `changes.md`
  states it.
- Then one bullet per change, in the order `changes.md` lists them, each bullet one line and no
  longer than 120 characters.
- Then a section `## Upgrade` with exactly one sentence naming any breaking change; when there is
  none, the sentence says there is none.
- Write nothing else.
```

`rubric/README.md` (100 points total):

```markdown
# Rubric: release note

- 20: `RELEASE.md` exists and its first line is a level-one heading with the exact version.
- 30: one bullet per change, in `changes.md` order, none over 120 characters.
- 20: a `## Upgrade` section with exactly one sentence.
- 20: the upgrade sentence names every breaking change `changes.md` marks, and none it does not.
- 10: nothing outside the specified structure.
```

`statement/changes.md` is written per case, with three changes of which one is breaking.

### Case `changelog-digest`

The same shape over a longer `changes.md` (eight changes, two breaking) and a tighter bullet limit,
so a mechanism that generalises across both cases is measurable and one keyed to the first case's
version string is not.

## The run

1. Build the Target and the Benchmark from the two case directories, publish it, and record both
   ids.
2. Run the Skill with the smoke profile and `T = 1`, `m = 1`, `k = 1`: calibrate `delta` from three
   `H_0` matrices (with two cases they will be identical, so `delta = 0` — say so as an
   adaptation), then one round.
3. The expected shape of the outcome, which is what the user should check:
   - one Proposer candidate with at most `b_max = 2` edits, each with a component and a hypothesis;
   - a Critic verdict, and a repair round when the first draft leaks;
   - `b_0 = 2`, `sigma_0 = 0`, `U_0 = K \ {} ` = every structural component untried;
   - `decisions.json` holding one decision with its `delta_S`, `delta_C` and reason string;
   - one appended scoreboard evaluation, and the final report.

## What the demo does not show

The Pruner needs `n_prune` rounds of history and a component whose recent best gain is
non-positive; the stall path needs `w` rounds without progress plus a variant count above 1; the
out-of-distribution claim needs a second Benchmark. A run of two or three rounds on a real
Benchmark is the smallest thing that shows all three, and the report must say which of them the run
actually reached.
