# Configuration and assessment data in the activity hierarchy

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

Loom's Configuration Data and Assessment Data rows in the activity hierarchy now open. Each
shows the module's own file for the ref: `configurations/<product>-<ref>.json` and
`assessments/<product>-<ref>.json`. The file is read from whichever module the player
would play, the assembled one or the checkout's.

## Details

- `GET /api/projects/:projectId/activities/:activityId/module-documents` returns both files
  and where they were read from. As in the player, the assessment falls back to the
  canonical ref's.
- The views are read-only: the module owns these files. They say which file was read and
  from where, and how many items an assessment has.
- The rows open once a module exists. Implementation Features stays in the tree, disabled,
  until Penguin has a feature catalogue for it.
- The conversation's focus accepts both sections.
