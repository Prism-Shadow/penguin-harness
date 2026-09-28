# Activity Stats in the activity hierarchy

- **Date:** 2026-09-23
- **Type:** feature
- **Scope:** `server`, `web`

Loom's Activity Stats row was added to the activity hierarchy, after Scenes. It counts the
media plan's assets and totals the size of their bound files, by asset type and by
language.

## Details

- `GET /api/projects/:projectId/activities/:activityId/media-stats` lists every asset of the
  plan with the size of its bound file. Each file is found where the player finds it: the
  draft's own media, then the WAF checkout's.
- A bound file that is not found is counted as bound but not sized, and the view says how
  many there are.
- The row opens once media is planned. The conversation's focus accepts it.
