# A product's refs in the activity header

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

The activity header now switches between a product's refs and names the open one, as
Loom's RefNum picker and Refs tab did.

## Details

- `PATCH /api/projects/:projectId/activities/:activityId/identity` with
  `{displayName?, stable?}` sets what an author calls a ref and whether it is stable. An
  empty display name clears it.
- A **Ref** picker lists the product's refs in the collection ("Ref 13 · Round two ·
  stable"). Choosing one opens it, through the page's guard against leaving unsaved edits.
- **Ref settings** edits the display name and the stable flag. A stable ref shows a
  **Stable** badge.
