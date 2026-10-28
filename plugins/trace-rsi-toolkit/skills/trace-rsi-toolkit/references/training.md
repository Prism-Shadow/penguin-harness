---
name: trace-training
description: Run TRACE as the main Curator inside one continuing training environment, using fresh Actor sessions and exporting the training-selected skill bank.
version: 2026.10.28.1
---

# TRACE training

Read `training-request.json` at the Agent State root and `benchmark-training.md` beside this Skill. Use their public inputs, feedback interface, ordered tasks, A attempts per task, R evolution rounds, runtime and export contract. The outside Organizer handles deployment and independent testing.

The main Agent is the Curator. It analyzes trajectories and updates the bank itself; it does not solve Actor tasks, draft their answers or spawn other Curators. Use the supplied Actor template and identity with Penguin's existing `run_subagent`. Every attempt uses a new child session with explicit Actor `agent_id`, `provider`, `model_id` and `thinking_level`. A fresh session does not require another Docker.

Use BANK and OUT from the request for the working bank and learning records. The prepared Actor template contains the fixed bank reader, empty catalog and entries directory. Snapshot that empty H1 bank before learning. Catalog entries have `id`, `description` and a relative `entries/<id>/SKILL.md` path; entry frontmatter has matching name, routing description and dated version. Keep the reader body fixed.

## Collect a complete batch

Install a frozen copy of the batch's bank in the Actor State before dispatch. Actor inputs consist of the current public task and attachments, API/tool instructions, the frozen bank and its own output location. Do not include previous answers or scores, Curator diagnoses or the parent conversation. Use the same solving configuration as the prepared test solver.

Run tasks in the supplied order, each with A fresh attempts. All attempts share this unit's business environment. Run sequentially unless state independence is established. Use supported resets where necessary; when state cannot be reset, record carryover rather than claiming independent environment trials.

An Actor submits its candidate and actual action/selection records, then finishes without asking for feedback. Freeze that candidate, invoke the permitted training judge once and retain the raw response. The main Curator reads this feedback; do not return it to the finished Actor or reopen that attempt to improve the answer. Preserve fractional scores and distinguish failed scoring from a scored failure.

Keep the bank unchanged until all task × A attempts finish. Later feedback stays separate from observations available before actions. Even an unchanged bank gets fresh prescribed attempts; old answers and measurements are not new samples. Record attempt/session identity, task, bank digest, candidate digest, actions, selected skills and feedback.

Collect H1 with the empty bank, bootstrap B0, measure B0, then evolve and measure B1…BR. With five tasks, A=2 and R=2 this is four batches of ten Actor sessions, not three independent training runs.

## Initialize

After collecting the complete H1 batch with the prepared empty bank, bootstrap B0. The main Curator analyzes public trajectories and separately labeled feedback through these stages, recording each intermediate result:

| Stage | Input and purpose |
| --- | --- |
| Task | For each task, use all its attempts to identify operations and supported failure mechanisms. |
| Type | For each publicly defined task type, remove instance-specific details from the task summaries. Use one type if no public mapping exists. |
| Operation | Merge type summaries into shared competencies with prerequisites and checks. |
| Decompose | Turn competencies into focused entries with distinct applicability descriptions. |

The main Agent performs all four Curator stages itself; do not spawn Curator subagents. Save proposed `{id, description, body, evidence}` entries and diagnoses before publication. Apply the evolution and publication rules below.

Publish validated B0 and retain its snapshot before collecting the B0 batch. Empty learned content is valid; there is no target number of skills.

## Evolve the bank

### Evidence and grouping

Use the completed batch collected with one frozen bank. Bind each attempt to its task, bank version, actual actions, candidate and score. Keep Actor-visible observations separate from later feedback, and record any shared-environment state carryover. Actor-visible evidence must not include previous-attempt feedback.

Group trajectories by the skill ids actually selected before actions. A trajectory can appear in several groups; selection plus success does not prove that every selected skill caused the success. Reading a file is not evidence of selection. Keep explicit empty selections, unknown ids and missing selection records distinct. If a nonempty-bank batch has no usable selection evidence, stop evolution and report the gap.

Success means raw score 1.0 (100 on the normalized scale). Keep fractional scores and failures, including groups with no successes. Never invent a successful contrast.

### Curator analysis

The main Curator keeps unused skills and groups containing only successes unchanged. For each group containing failures, compare the frozen entry against its assigned successful and failed trajectories. Save a proposal and diagnosis:

```json
{"replaces":"id","skills":[{"id":"trace-operation","description":"...","body":"...","evidence":["event-reference"]}],"diagnosis":"..."}
```

For no supported change, record `{"replaces":"id","unchanged":true,"diagnosis":"..."}`. A rewrite retains the id; a supported split replaces it with focused entries. Deletion alone is not an update. Analyze each group against the same frozen bank, then combine proposals for publication.

The main Curator also examines recurring behavior with explicit empty selections or unknown ids. Propose additions or routing repairs only when supported across at least two distinct training tasks; repeated attempts on one task do not meet that threshold. This is an engineering threshold, not a paper constant. Missing logs do not establish a missing skill. An empty proposal is valid.

### What belongs in a skill

- A reusable operation with observable applicability conditions, inputs, actions and verification. Preserve demonstrated useful behavior and available-capability limits.
- Keep uncertainty in the diagnosis; omit unsupported prescriptions. A failed attempt supports a diagnosis, not proof that an untried fix works.
- Remove case ids, instance names, dates, answer values and training-record paths from deployed text. Store source evidence separately. Genuine API names, parameters and domain constants may remain where the operation needs them.
- Do not teach access to private grading material, reward shortcuts, or dependence on task order and hidden state. The skill must be usable without training feedback.

### Publish

Stage the combined proposals outside the live bank. Check unique ids (`trace-` plus lowercase kebab case, at most 64 characters), matching frontmatter/catalog paths, nonempty descriptions and bodies, and evidence resolving to assigned events. Review scope, preserved useful behavior and memorized answers semantically; file checks alone are insufficient.

The catalog must list exactly the deployed entries at `entries/<id>/SKILL.md`. Keep untouched entries and the fixed reader body unchanged. Source evidence and feedback stay outside the bank. Reject unsupported proposals; record the reason and retain the last validated bank. Any revised Curator proposal needs its own evidence and validation record before publication.

Publish once between complete batches, version changed content and retain the snapshot, raw proposals and evidence mapping. No change consumes the round without forcing a new version. Collect the next batch under the published bank. Execute the prescribed fresh Actor attempts even for an unchanged bank.

Continue evolution from the just-published bank even if its score falls; do not roll back mid-training. After the full budget, select the deployment checkpoint using the rule below. Test results never choose or revise it.

## Select and export

Select separately for each group, only after every planned H1, B0…BR batch is complete. The default is `selection: best_train`, an experiment adaptation fixed before training.

- Eligible candidates are the validated B0…BR banks with their complete prescribed training measurements; H1 is a baseline, not a candidate. Empty learned content in B0 is still valid.
- Rank by the mean normalized training score across all tasks and all prescribed repetitions, using unrounded scores. Do not use best-of-A, full-success count, or only the five exported answers. If several stages among B0…BR have an identical bank hash, treat them as one candidate and pool their distinct complete batches with equal weight per task/attempt; never count the same measurement twice.
- Break an exact tie by earliest originating stage (B0 before B1, etc.). Fix this rule before learning. Record that earliest stage as the selected stage for an unchanged bank appearing in multiple batches.
- Save `OUT/selection.yaml`: rule, all candidate stage labels/hashes/means, evidence references and counts, selected stage/hash, tie-break and completion status. Keep all stage snapshots and training scores, including the last stage even when it loses.
- A user may explicitly request `selection: final` before the experiment, which selects BR (B0 for R=0). Never change selection or add training attempts in response to test results.

Install/export the exact selected snapshot; changing its learned text would create an unmeasured candidate. Keep selection evidence outside the deployed bank. The Curator exports it and its full training records; the Organizer independently verifies it before deployment. Missing stages, failed scoring or invalid evidence mean the experiment is incomplete, not permission to select from a convenient subset.

## Export the handoff

Copy the exact selected bank to the Skill export path in benchmark-training.md. Export all stage snapshots, task/attempt records, bootstrap analyses, proposals, publication decisions and selection.yaml to the separate training-records path. Keep evidence and answers out of the deployed bank.

Where the benchmark requires final training answers, export each task's last unmodified candidate from the selected stage's batch and record its attempt id. For identical banks pooled across stages, use the selected earliest originating stage consistently. Follow the public answer filenames and format; do not generate new answers during export.

Report completed stages, actual stage means, selected stage/hash and unresolved failures. Missing phases or failed scoring mean an incomplete handoff. Preserve the last valid bank and evidence; the Organizer decides eligible infrastructure recovery under the declared policy. Do not extend the budget or select using held-out results.
