# Change a ref's number

- **Date:** 2026-09-25
- **Type:** feature
- **Scope:** `server`, `web`

A ref numbered wrongly can be given another number from the activity header: **Change
number** opens a dialog that takes the new number and keeps the ref's script, specification,
media, uploads and run history, all of which Penguin keys by the activity rather than its
number.

- New route `POST /api/projects/:projectId/activities/:activityId/ref-number` with
  `{ refNum, expectedRevision }`, for project owners. It updates the ref's number, the
  product's canonical number when this ref owns the module, and the `refNum` of the draft's
  media manifest, which gives the draft a new revision.
- Refused with `ref_stable` while the ref is marked stable, `activity_exists` when another ref
  of the product uses the number (a deleted ref keeps its number), `draft_conflict` when the
  draft changed, `run_active` or `pipeline_running` while work is running on it,
  `ref_unchanged` for the same number, and `checkout_ref` when the ref's module comes from the
  read-only WAF checkout, whose files are named by the current number.
- If writing the draft fails, the numbers go back to what they were.
- Module runs already assembled keep the old number in their file names. When the ref has an
  assembled module, the author is told to assemble it again so the preview plays under the
  new number.
- The dialog refuses a number another listed ref uses before sending, and while the ref is
  stable it says to clear Stable first.
