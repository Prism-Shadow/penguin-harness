# Apply or discard an agent's whole proposal

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

An agent's proposal in the activity conversation can now be applied whole, as one change
to the draft, or set aside. Accepting one change at a time still works.

## Details

- `POST /api/projects/:projectId/activities/:activityId/runs/:runId/proposal/apply` with
  `{expectedRevision}` reads the proposal fresh from the run. It applies every change in one
  draft change, all or none: media text first, while the plan still matches the
  specification, then the script, then the specification.
- `POST …/proposal/discard` renames the run's `proposal.json` to `proposal.discarded.json`.
  The discarded proposal stays with the run for its trace, and the studio stops offering it
  until the agent writes another.
- The proposal card shows **Apply N changes** when more than one change is still open, and
  **Discard** behind a confirmation.
