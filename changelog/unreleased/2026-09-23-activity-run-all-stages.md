# Run all stages from the activity hierarchy

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

An activity's stages can now be run with one click, as in Loom's pipeline controls. A stage
picker ("All stages" by default) and **Run** were added at the foot of the activity
hierarchy, and a **Stages** panel follows the run.

## Details

- `POST /api/projects/:projectId/activities/:activityId/pipeline` with `{stage, agentId |
  codingAgentId, voice?, wafRoot?, bookMode?}` starts the sequence and answers at once with
  its plan. `GET …/pipeline` reports it, and `POST …/pipeline/stop` stops it.
- The sequence chains the runs an author could start by hand, in order:
  - generate the specification;
  - plan media (kept when the plan already matches the specification);
  - generate and accept every unbound narration that has a script, in every language;
  - generate and accept every unbound image that has a description;
  - assemble the module.

  Each run is an ordinary run in Generation History with its own Session.
- A failed step stops the sequence with the run's own reason, and nothing after it runs.
  **Stop** cancels the run in flight. With a coding agent, the media steps are skipped and
  the panel says why.
- The sequence is held in the server's memory and was not persisted. Its runs stay in the
  history either way.
- The **Stages** panel lists each step with its status and progress (for example "2 of 5"
  narrations). It shows the running step's Session live, with approvals answerable in place.
  Selected text in that transcript can be added to the activity's conversation.
- The conversation panel and the Stages panel share one transcript hook.
