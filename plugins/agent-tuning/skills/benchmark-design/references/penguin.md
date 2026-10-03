# Penguin benchmark design

Penguin's default calibration recipe. Follow the parent Skill's file formats,
parallel evaluation protocol and reporting contract. This recipe supplies the
Pilot policy, difficulty refinement, private-standard rules and publish gate.

## Default settings

Require a target capability, desired baseline score on `0..100` and positive Pilot
iteration limit. Every Pilot has one Run per Case; do not ask for or accept another
Run count for this recipe. The publish gate is below 85, independently of the
user's desired calibration score. Use `runs = 1` in the Benchmark config.

## Workflow

- A **Pilot** is a one-Run-per-Case evaluation used to improve the Benchmark. Unselected Pilot results never enter the Scoreboard; the selected result becomes the Formal Baseline after Freeze.
- **Freeze** means the Benchmark revision and evaluation settings stop changing.
- A **Formal Baseline** is the accepted result of the selected complete valid Pilot revision, recorded after that exact revision is frozen on one unchanged Agent State version.

Follow this order:

1. Validate the Test Agent, target capability, resolved evaluation Runtime, and evaluation access.
2. Write a Capability Contract that defines the observable process to measure, common weaker behavior, and the general Agent State improvement the Benchmark should train.
3. Plan the complete initial Case set and point allocation. For each Case, privately state the intended behavior, a plausible shortcut for a strong Test Agent, and how the Case distinguishes them. Write and leak-check the complete initial Benchmark.
4. Complete one valid evaluation for every planned Case. Together these results form Pilot iteration 1; finish this complete set before refining any Case.
5. For later Pilot iterations, use scores and Traces to reconstruct how the Test Agent solved each Case. A single iteration may refine multiple Cases or difficulty dimensions; rerun every affected Case.
6. Freeze the first valid Pilot revision that meets the desired baseline score. If none does within the requested valid-iteration limit, restore and freeze the lowest-scoring valid Pilot revision. The desired score steers refinement; the publish gate is fixed at 85 on the `0..100` scale, so a frozen revision that scores below 85 is published even when it misses the desired score.
7. Freeze the selected revision and record its complete one-Run-per-Case Pilot result as the Formal Baseline when every cell is valid, the Agent State version remains unchanged, and no known design defect remains. Do not rerun or backfill it. The Formal score does not determine validity.

## Case design and scoring

Before planning Cases, state the Capability Contract:

- the public evidence available to the Test Agent;
- the observable decisions, intermediate artifacts, and checks the capability requires;
- the weaker behaviors or shortcuts the Benchmark should distinguish; and
- the reusable Agent State behavior that could improve the measured capability.

Before writing each Case, privately record the required behavior, a plausible shortcut for a strong Test Agent, the chosen difficulty, the different scored decision or artifact each behavior should produce, and why the distinction measures the target capability. Design the Case so the measured capability affects the score. Do not optimize the Statement to help the Test Agent succeed or copy this design rationale into it.

The Statement presents the task, not the Benchmark's teaching or design intent. It describes the objective, available materials, option meanings, output format, and necessary constraints. It must not prescribe the reasoning sequence, identify decisive evidence, name the shortcut, or reveal private scoring preferences. When an auditable artifact is needed, request concise supporting evidence without prescribing how to obtain it.

Keep the evaluation contract well-defined, but do not require the public Statement to uniquely determine the Gold. Public information may be incomplete or conflicting, and the Rubric may encode a private decision standard or preference. Fix that private standard before evaluating the revision and never change its Gold after seeing the evaluated answer. The standard must remain tied to the target capability: it should express a stable reusable policy, priority, inference boundary, or other behavior that a better Agent State could apply across instances. Do not use a capability-irrelevant random hidden mapping merely to lower the score, and do not disclose every decisive premise or priority merely to make the public task complete.

The first complete revision is an exploratory probe. Use its Pilot to learn how the Test Agent interprets the tasks, forms candidate rules, and uses shortcuts; refine the Benchmark before treating it as calibrated. A later revision may intentionally add information gaps, conflicts, private preferences, or other capability-relevant distinctions in response to an earlier Trace, provided the next revision's Rubric is fixed before dispatch.

Every Case Rubric has a fixed maximum of 100 points, with observable scoring items and meaningful partial credit. Allocate most points within each Case to decisions or concise artifacts on which the intended behavior and plausible shortcut differ. Keep generic format compliance, evidence enumeration, and analysis completeness from creating a high score floor unless those are themselves the target capability. Allocate points from capability coverage before the first Pilot. Do not change scoring items solely to satisfy the desired score; when a redesign changes coverage, re-plan that Case's 100-point allocation before evaluating the revised Case set. When final choices do not distinguish the intended behavior from a shortcut, score a concise auditable artifact, but define only its required content or format—not the method used to produce it.

Before the first dispatch of every new or changed Case revision, run a consistency review:

- Confirm that the current Statement is internally coherent. Intentional conflicts must be presented as conflicts between sources, rules, or positions rather than as contradictory claims by the Benchmark itself.
- Confirm that the current Rubric is consistent with the current Statement and fixed private standard. It must be self-contained and must not refer to an earlier revision or missing context.
- Confirm that every scoring item applies to the Case's actual requested output and relies only on premises that are defined, provided, or explicitly private under the fixed standard.

This review does not require the public Statement to contain enough information to reproduce the private standard or uniquely derive every Gold answer. Unchanged Cases do not need another review during that iteration. Keep this review in Builder analysis and Trace; fix defects in the Case rather than creating a separate audit artifact.

Also compare all public files with the private Rubric. Confirm that no public file reveals Gold answers, private scoring conditions, or hints that identify the intended solution. This is the leak check.

## Refine the Benchmark

Treat the first draft as a hypothesis. The first valid result from every planned Case together forms Pilot iteration 1. A later iteration starts after a difficulty refinement and completes when every affected Case has a valid new result. Request corrections, validity repairs, and evaluation reruns stay in the current iteration and do not consume the requested iteration budget. Use the recorded Agent State version and fixed evaluation runtime.

Keep unselected Pilot results out of the Scoreboard. During calibration, retain only one temporary restorable copy: the lowest-scoring complete valid revision seen so far, including its one-Run-per-Case result. Store it outside the Project's `benchmarks/`, replace it only when a lower valid revision completes, and never retain invalid revisions.

Use the Pilot to find the current Test Agent's capability boundary.

Before editing, distinguish a validity repair from a difficulty refinement. A validity repair fixes an unusable task or scoring contract and stays in the current Pilot iteration. A difficulty refinement changes what the valid Benchmark measures and completes the next iteration after every affected Case has a valid result.

Before editing, estimate how much of the score the planned refinements can affect. If the range is too small to materially approach the desired score, revise more affected Cases, use more than one difficulty dimension, or replace low-signal Cases.

Prefer refinements that create one or more scored separating decisions. A refinement may change the public task or evidence, introduce or preserve a reasonable information gap or conflict, or apply a fixed private standard. Adding another explicit rule, exception, source, or checklist is not a difficulty increase when the observed strategy can still follow it to the Gold. A Rubric-only refinement is allowed but not preferred when the public task already contains the relevant information, the current Rubric fails to distinguish merely mentioning it from handling it correctly, and the Builder can explain which reusable capability the new scoring distinction measures. Do not add points merely because the previous Test Agent omitted a phrase. Fix the revised Rubric before dispatch and treat it as a changed Case revision.

For each refinement iteration:

1. **Observed strategy.** Reconstruct the Test Agent's actual solution method from its score, artifact, and Trace.
2. **Missing behavior.** Identify the general behavior that the observed strategy skipped or simplified. Repair missing evidence, arbitrary mappings, ambiguity, or scoring defects before increasing difficulty.
3. **Separating prediction.** Before dispatch, predict the decision or artifact the observed strategy will produce, the different result the desired behavior will produce, and the score range affected. If both behaviors are expected to reach the same scored result, choose another refinement.
4. Update any number of diagnosed Cases or difficulty dimensions, run the consistency review and leak check for each changed revision, and rerun every affected Case.

Reuse a Pilot result only when the Case revision, scoring, Agent State version, and evaluation runtime are unchanged.

An information gap or supported alternative is not automatically a design defect. Treat it as a defect only when the task or fixed private standard is incoherent, changes after evaluation, leaks the answer, or no reusable Agent behavior could plausibly improve the score.

More rows, fields, distractors, files, near-duplicate examples, or explicit rule layers do not increase difficulty when the observed strategy still solves the Case. Base refinements on observed behavior and fix the Gold before each evaluation.

Freeze immediately when a complete valid Pilot iteration meets the desired baseline score and no known design defect remains. Do not run another difficulty refinement merely to create more score margin. Otherwise continue through the requested valid-iteration limit. If the desired score is still unmet, restore the temporary lowest-scoring valid revision and proceed to Freeze. The desired baseline score is a calibration target, not the publish gate: the gate is fixed at 85 on the `0..100` scale, and any frozen valid revision scoring below 85 is published, however far it stays from the desired score. Report `calibration_failed` only when no valid Pilot revision can be produced, evaluation failures prevent a valid selection, or the lowest-scoring valid revision still scores 85 or above at the iteration limit — a Test Agent that already scores that high leaves the Benchmark nothing to measure. Missing the desired score alone is never a failure.

## Freeze and record the Formal Baseline

After selecting the Pilot revision, restore that exact revision and its complete result if needed. Run a complete consistency review and final leak check across every Case. If the review finds a defect, repair it and produce a complete valid one-Run-per-Case Pilot result for the repaired revision before selecting and freezing it. Freeze the Benchmark and record the current Agent State version. Do not launch a fresh Formal matrix, rerun the selected Pilot, or backfill it to another Run count.

Accept the selected Pilot result as the Formal Baseline when every Case has exactly one valid Run, every cell reports the frozen evaluation runtime, the Agent State version remains unchanged, the private scoring standard remained fixed, and every score loss reflects the Capability Contract. Record the Formal Baseline even when its score does not meet the desired baseline score; only a score of 85 or above blocks it.

Report `calibration_failed` only when no valid revision remains, evaluation failures prevent a complete selected Pilot result, or the selected revision scores 85 or above. Never record a partial, abandoned, invalid, or non-selected Pilot result as the Formal Baseline.

## Publish and finish

After recording the selected complete Pilot as the Formal Baseline, set
`status = "published"`. On `calibration_failed`, set `status = "failed"` instead.
Change only that config field, preserve title/description/runs, and reparse the TOML.
Missing the desired score alone is not failure; the below-85 publish gate applies.

Report one compact row per Pilot with its score, capability gap, adjustment and
freeze/stop decision. Identify the selected Pilot. Delete temporary restorable
copies and calibration scaffolding after handoff; keep the frozen Benchmark,
Scoreboard, evaluation Workspaces and score-linked Traces.
