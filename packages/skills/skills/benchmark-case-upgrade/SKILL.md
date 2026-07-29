---
name: benchmark-case-upgrade
description: Apply one difficulty-upgrade technique to a Benchmark Case under guardrail checks derived from benchmark-design principles.
short_description: Upgrade one Benchmark Case's difficulty with guardrail-protected edits.
short_description_zh: 在护栏保护下，对单个 Benchmark Case 执行一项难度升级编辑。
version: 1
updated: 2026-07-29T00:00:00Z
---

<!-- Author: ZhiJin Nan <cinderelladoyle@icloud.com> | SPDX-License-Identifier: Apache-2.0 -->

# Benchmark Case Upgrade

Apply exactly one upgrade technique to a single Benchmark Case. Run four guardrail checks before and after every edit. This Skill edits Case files; it does not re-evaluate or write the Scoreboard.

## Before you start

Require a target Case path, a `root_cause` (agent_strong | case_weak | rubric_loose), a `recommended_techniques` priority list, and the original file bytes for every file under the Case's `statement/` and `rubric/` directories. If any are missing, ask the caller.

## Guardrail checks (pre-edit)

Run all four checks before touching any file. Stop and report which guardrail failed if any does.

### G1 — Counterfactual (benchmark-design principle 3)

Ask: *Could a competent executor without the target capability complete this Case by mechanically following the Statement?*

If the proposed edit would make the answer "yes" (the task no longer requires the target capability), reject it. This guardrail applies most strictly to S2 (+ambiguity): removing too much structure can turn the task into a generic instruction-following exercise.

### G2 — Fairness (benchmark-design principle 6)

Verify the edit does **not** introduce:
1. Missing essential evidence (the answer becomes un-inferable)
2. Trivia (irrelevant detail as a scoring barrier)
3. Formatting traps (score hinges on undocumented format expectations)
4. Excessive workload (more steps without more discrimination)
5. Infrastructure instability (non-deterministic or environment-dependent behaviour)

S4 (+noise) risks trivia. S6 (+steps) risks excessive workload. R4 (tight equivalence) risks formatting traps. Apply extra scrutiny to these.

### G3 — Atomicity (benchmark-design principle 7)

If editing the Rubric: every scoring item after the edit must remain independently judgeable. One item's score must not depend on another item's interpretation.

### G4 — Structural refinement (benchmark-design principle 11)

Ask: *Does this edit introduce a new failure mode or sharpen discrimination, or does it merely add steps/items?*

Reject S6 (+steps) when it is the only technique — more steps without a new capability dimension is not structural refinement. S6 may accompany S1–S5 as a natural consequence (e.g., a new constraint naturally adds a step), but never as the sole technique.

## Select a technique

From `recommended_techniques`, pick the first technique that passes all four guardrails. Apply exactly one technique. The techniques are:

### Statement techniques (edit `statement/`)

| ID | Technique | Operation |
|----|-----------|-----------|
| S1 | +constraint | Add an explicit requirement (edge case, constraint, precondition) to README.md |
| S2 | +ambiguity | Remove an explicit step or hint; let the Agent infer the method |
| S3 | +multi-file | Require cross-file operations; may add a supporting data file |
| S4 | +noise | Add an irrelevant or misleading file to `statement/` |
| S5 | -shortcut | Remove a hint, example, or format template from README.md |
| S6 | +steps | Add a task step — **only as a companion to S1–S5, never alone** |

### Rubric techniques (edit `rubric/`)

| ID | Technique | Operation |
|----|-----------|-----------|
| R1 | finer granularity | Split one coarse item into 2–3 finer items with independent points |
| R2 | +coverage | Add a scoring dimension (edge case, error handling, validation) |
| R3 | specific partial credit | Replace "partially correct = half" with precise conditions |
| R4 | tight equivalence | Tighten what counts as "equivalent" output |

### Supporting-file techniques (edit files in `statement/`)

| ID | Technique | Operation |
|----|-----------|-----------|
| F1 | +evidence complexity | Replace a data file with a larger or more complex variant |
| F2 | +distraction data | Add a file to `statement/` that looks relevant but is unrelated |

## Execute the edit

After selecting the technique, make the smallest file change that implements it:
- Edit `statement/README.md` or `rubric/README.md` directly.
- When adding supporting files, create them inside the appropriate directory.
- Record every file path changed or created.

## Guardrail checks (post-edit)

Re-read every changed file. Verify:

1. **Counterfactual** — the edited Case still measures the same capability.
2. **Fairness** — no new trivia, traps, or missing evidence introduced.
3. **Rubric six-state coverage** (if rubric changed) — full, partial, missing, malformed, wrong-type, and extra output each have a reasonable score path.
4. **Privacy** — no Rubric content leaked into the Statement.

If any post-edit guardrail fails, revert the changes and report which guardrail failed.

## Return protocol

Output exactly one plain YAML document beginning with `upgrade_result:` and stop. Do not use a code fence.

```yaml
upgrade_result:
  case_id: <case_id>
  technique_applied: S1
  files_changed:
    - statement/README.md
  guardrails_passed: true
  guardrail_details:
    counterfactual: passed
    fairness: passed
    atomicity: passed
    structural_refinement: passed
  expected_effect: "<one sentence describing the expected difficulty increase>"
```

When all techniques in the list fail guardrails, return:

```yaml
upgrade_result:
  case_id: <case_id>
  technique_applied: null
  files_changed: []
  guardrails_passed: false
  guardrail_details:
    counterfactual: failed
    fairness: passed
    atomicity: passed
    structural_refinement: passed
  expected_effect: "no applicable technique passed all guardrails"
```

Never reveal Rubric content, scoring items, or golden answers in `expected_effect`.
