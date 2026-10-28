# Feedback when business evidence is incomplete

New isolated experiments default to `feedback_policy: bounded-evidence-v2`. Record it in
the experiment configuration. Explicit `strict` and `bounded-evidence-v1` retain their
continuation rules. An existing journal keeps its recorded behavior and plugin version.
Do not change an active policy, reopen a stopped run or relabel old measurements.

The paper's virtual tests are an imperfect proxy. Requiring proof of every business rule
before construction may finish is a Penguin addition, not a prerequisite for OpenSkill.
Keep the independent oracle review, complete requirement inventory, fixed skill plan,
persistent creator, original budgets, last-revision export and freeze before target scoring.
Unknown evidence remains unknown. It need not become a repeated infrastructure repair.

## Choose feedback from the observed problem

| Observation | Action |
| --- | --- |
| Supported assertion fails or reusable skill structure is invalid | Diagnose and `revise_skill`; apply the changed skill in fresh practice, then independently verify |
| Pytest/setup/coverage protocol is invalid, or a supported requirement has no check | `repair_verifier` within its original allowance; preserve valid expectations |
| Actual execution/delivery fault with valid unchanged skills | `repeat_practice` with concrete execution evidence |
| Supported checks pass, but an observed skill behavior is defective | `revise_skill` with `skill_findings`; absence of a business policy alone is not such a finding |
| Every supported check passes and only unsupported business semantics remain | `finish_evidence_limited`; retain the unknown requirements and final skills |

Classify the defect being repaired. If its correction is already justified by available
knowledge, use `SELF-FIXABLE` even when unrelated policy questions remain unknown. A
`coverage_gap` in the same report does not automatically require `NEEDS-DR`. Address real
supported failures before spending verifier repairs on unrelated unknown semantics.

Review each unsupported claim independently. A public price and quantity can support their
product even when the prices of other operations are unknown. Give these separate requirement
IDs and keep the unknown remainder. Cover substantive computations, record joins and
cross-field constraints as well as output shape. Do not reduce a business requirement to an
enum check or add guessed thresholds to force failures. Synthetic examples may test a
documented reusable behavior, but must exercise the candidate's applied behavior rather than
asserting an independently computed constant against itself. Preserve prior valid assertions.

When no assertion or structural failure establishes a skill defect, `feedback` with
`next_action: revise_skill` must include nonempty `skill_findings`:

```json
{
  "id": "retrieval-status",
  "observation": "A failed public retrieval was reported as a successful empty collection",
  "affected_resources": ["collector/scripts/fetch.py"],
  "planned_change": "Separate unavailable routes from successfully retrieved empty records",
  "validation": "A missing-route practice fixture produces an explicit unavailable-evidence entry",
  "evidence": ["tasks/CASE-001/diagnoses/retrieval-observation.json"]
}
```

Each finding needs actual retained evidence, also included in the feedback's top-level
`evidence` list. The controller reviews its meaning; file hashes alone prove neither the
defect nor the proposed fix. Cosmetic edits and mandatory minimum revision counts are not
learning evidence. A first draft may already pass every available check.

## Review observed skill behavior before choosing feedback

In v2, `next` returns `review_skills` after the first valid measurement of each revision.
This is one controller review per revision, not another model role or a repeat of the
review for each verifier repair. Inspect the documented interfaces and reusable procedures
against the retained execution evidence. Prioritize reachable contract defects, such as
a documented input form raising an exception. Do not attempt to prove every unknown
business rule. A clean review may contain empty `findings` and `resolved` lists.
If additional evidence reveals a defect before feedback is sealed, a supplemental review
may add it using a new record path. Retain every old finding or independently resolve it;
the previous review stays sealed. This does not require repeated empty reviews.

Write `tasks/<case_id>/review/skills-<revision>.json`, then submit
`executor.py event` with `{"action":"skill-review","case_id":"<case_id>","record":"<path>"}`:

```json
{
  "revision": 0,
  "skills_sha256": "<current registered skill digest>",
  "outputs_sha256": "<current registered output digest>",
  "assessment": "Reviewed the documented plan interface against frozen practice execution",
  "findings": [
    {
      "id": "list-plan",
      "observation": "The documented list input raises AttributeError in frozen execution",
      "affected_resources": ["collector/scripts/fetch.py"],
      "planned_change": "Accept the documented list and object forms while preserving their behavior",
      "validation": "Execute both forms on public inputs and independently check the resulting counts",
      "evidence": [
        "tasks/CASE-001/diagnoses/list-plan.json",
        "tasks/CASE-001/practice/revision-0/loader.json"
      ]
    }
  ],
  "resolved": [],
  "feedback_files": {
    "list-plan.json": "tasks/CASE-001/diagnoses/list-plan.json"
  }
}
```

Resource paths are relative to the revision's skill root. Evidence paths are relative to
OUT and must belong to this Case. The record and its evidence are sealed; neither can be
overwritten. `feedback_files` explicitly selects public diagnostics under this Case's
`diagnoses/` directory for the creator. Review their contents for forbidden information.
The executor transfers them read-only as `inputs/finding-evidence/` together with
`inputs/skill-review.json`; it does not transfer those files to the independent verifier.
The controller reviews meaning and relevance. Hashes cannot discover a defect or prove
that a regression assertion tests it.

`next` reports `open_skill_findings` and adds `skill_behavior` to `latest_issues`. Submit
ordinary feedback with every reported issue and the exact active findings in
`skill_findings`, including their evidence in the feedback evidence list. A known finding
blocks `surrogate_pass` and `evidence_limited`, even when the output proxy accepted the
revision. Use `SELF-FIXABLE` when available evidence already justifies the correction.
Verifier repair requires its own execution fault or independently justified
`oracle_correction`; it never clears the skill findings.

The same creator must change an affected resource and apply the changed skills in fresh
practice. A revision may address part of the findings; retain the rest for later feedback
within the existing budget. Independent verification then tests the documented
behavior against public inputs and anchors. Include observable contract probes in the
initial output allowlist where appropriate; do not change that allowlist halfway through
a Case or treat creator self-checks as independent acceptance.

After the new measurement, retain unresolved findings verbatim. Resolve a finding only
with an actual skill revision and passing tests in the current independent report:

```json
{
  "id": "list-plan",
  "finding": "Fresh executions of both documented forms return the independently derived count",
  "evidence": [
    "tasks/CASE-001/verify/attempt-2/report.xml",
    "tasks/CASE-001/practice/revision-1/loader.json"
  ],
  "tests": ["suite::test_plan_forms"]
}
```

Place this row in the new review's `resolved` list and remove it from `findings`.
The executor checks that each named JUnit test actually passed in that measurement.
The controller must confirm the test exercises the defect rather than an unrelated
passing assertion. Old reports, invented test IDs and silent removal are refused.

This review adds no practice, search, verifier or recovery allowance. At the last
verification attempt, the source ordering still permits the final feedback-driven edit
and fresh practice. Close as `max_refinement_retries` with `final_was_tested: false`;
retain the unresolved finding because no independent regression measurement remains.
Use an evidenced budget stop when work cannot finish. Do not label that outcome repaired
and verified or reopen a stopped run.

## Continue after unsuccessful research

For `NEEDS-DR`, issue and record a targeted search when budget is available. If no search
returns usable evidence, `next` can offer `record_research_fallback`. It also offers this
when previous rounds have spent the search cap. Pending searches must finish first.

There is **one fallback per Case**, shared by all revisions, only for `revise_skill`. It
does not add a search, verification, practice slot or extra time. Record the decision:

```json
{
  "action": "research-fallback",
  "case_id": "CASE-001",
  "attempt": 1,
  "reason": "The recorded policy search supplied no usable source",
  "unresolved": ["The applicable routing policy is still unknown"],
  "planned_change": "Fix the observed retrieval-status bug using the available API contract",
  "validation": "Regenerate outputs and independently test retrieval status and known record joins",
  "evidence": ["tasks/CASE-001/research/search-1.json", "tasks/CASE-001/diagnoses/attempt-1.json"]
}
```

The executor supplies `inputs/research-fallback.json` to the persistent creator. The creator
reads its limits and original feedback, edits reusable content, then applies the frozen new
revision in fresh practice. Keep uncertain choices explicitly qualified. An empty search
does not authorize a guessed policy or prove that no policy exists anywhere. Do not put
unavailable responses into `research_files`; that mapping still accepts only sealed
successful retrievals. The journal seals the fallback evidence and checks it on continuation.

If no defensible, testable change exists, do not manufacture a revision. Preserve the gap
and use the appropriate evidenced stop. A fallback may fail to improve the skill; subsequent
verification must report that outcome. It never overrides a STOP or isolation failure.

## Close without confusing proxy coverage with target success

`next` reports `evidence_summary` and `evidence_limited_eligible`. Eligibility requires a
completed valid measurement, valid skill structure, at least one supported requirement,
passing tests for **every** supported requirement, and only genuinely unsupported rows left.
A missing supported test, skipped/failed mapped test, malformed coverage or interrupted
measurement cannot qualify. In v2 the current revision must also have a sealed skill
review with no unresolved findings. The complete coverage map and `accepted: false` remain intact.

Record ordinary feedback with `next_action: finish_evidence_limited`, describing the known
results and unresolved limitations. Then stop role writers, complete the usual process
review, and submit `finish-case` with `reason: evidence_limited`, `process_review` and a
`record` containing:

```json
{
  "reason": "evidence_limited",
  "workers_stopped": true,
  "cause": "All supported checks passed; the collected public evidence does not establish the remaining policy",
  "unresolved": ["<every ID in evidence_summary.unverified, in the recorded order>"],
  "evidence": ["tasks/CASE-001/verify/attempt-2/coverage.json", "tasks/CASE-001/verify/attempt-2/report.xml"]
}
```

Report this as supported proxy checks passing with incomplete business verification, not
`surrogate_pass`, benchmark accuracy, timeout or verifier infrastructure failure. Valid final
skills can enter the normal global freeze after every construction Case finishes. Evaluation
still happens only after that freeze. No target score enters the feedback loop.
