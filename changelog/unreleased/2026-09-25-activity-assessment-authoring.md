# Generate an activity's assessment, and edit its items without JSON

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

An author can now press **Generate assessment** in **Assessment Data**. An agent writes one
question for each screen where the learner makes a choice, with its choices and its correct
answer. The result is checked so that no question the screens imply is dropped, and it waits
beside the current assessment until the author presses **Use it** or **Keep current**. The
assessment's items can then be edited in place: the question, the choices, which choice is
correct, and shuffle. Items and choices can be added and removed. The JSON editor moved into an
**Edit as JSON** fold.

- New run kind `assessment`. `POST /api/projects/:projectId/activities/:activityId/generate-assessment`
  takes `{ agentId | codingAgentId, expectedRevision }`. It is refused with
  `assessment_spec_required` (400) without a valid specification, `assessment_unused` (409)
  when the specification's `runtime.usesAssessment` is false, and `not_canonical` (409) on a ref
  that is not the product's canonical ref. The activity's description is not required.
- The run's workspace holds `activity-spec.json`, `description.md`, `input.json`, the
  `waf-assessment-patterns` skill as `assessment-skill.md`, and `current-assessment.json` when
  an assessment is already in effect (the author's edit, else the module's own), which the agent
  updates rather than replaces.
- One run writes `assessment-hints.json` (the questions the screens imply) and
  `assessment.json`. Collection keeps only `SIMPLE_CHOICE` and `MULTIPLE_RESPONSE_CHOICE` items,
  refuses `qa_`, `prod_` and `dev_` keys, and derives the titles (`<code>-<canonicalRef>` and
  `<code>-<canonicalRef>-<n>`), each choice's score, `configuration.maxItems`,
  `nextItemsSize: 1` and `behavior: "LINEAR"`. The hints are bounded to 200 questions of 500
  characters. A run whose assessment misses a hinted question, in order, fails and names every
  missing question.
- `POST .../runs/:runId/accept-assessment` with `{ expectedRevision }` stores a successful
  run's candidate as the product's assessment edit on the draft it was generated from, so the
  preview and every assembly use it.
- **Run all stages** gained an `assessment` step between `images` and `module`. It is skipped
  with the note `noAssessment` when the specification has no assessment, and `notCanonical` on a
  ref that does not own it; otherwise it generates and accepts the assessment.
- **Assessment Data** opens before a module exists when the saved specification uses an
  assessment. The items editor names each problem that holds the save (no items, fewer than two
  choices, the wrong number of correct choices, an empty question or choice, a repeated choice
  id), keeps every field of the document it does not show, and names a new item after the
  document's title. A document with other interaction kinds is edited as JSON.
