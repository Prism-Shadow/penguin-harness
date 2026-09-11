# Syncing presets keeps the model's display name

- **Date:** 2026-09-11
- **Type:** fix
- **Scope:** `web`, `server`
- **PR:** [#679](https://github.com/Prism-Shadow/penguin-harness/pull/679)

[中文版](2026-09-11-catalog-sync-display-name.zh.md)

A model added to a Project by the Models page's "sync presets" button was saved without a display
name and listed under its raw model id, and syncing again never brought the name back. The rows a
sync builds now carry the built-in catalog's name, and a sync fills in the name of any preset row
that has none, which repairs the Projects an earlier sync had already written.

## Details

- The models endpoint distinguishes an absent display name from an empty one. Absent means
  "inherit whatever the built-in catalog calls this model"; the empty string means the user
  cleared the name, and only it records that deletion on disk. The route previously dropped an
  empty string before the service saw it, leaving the service to read an absent name as a
  deliberate clearing — so a client that merely had no name for a model cleared the name of every
  catalog model it sent.
- `GET /projects/:id/models` reports a cleared name as an empty string rather than as no name, so
  the whole table coming back on the next PUT still says "cleared" instead of asking for the
  catalog's name again.
- "Sync presets" fills a blank name from the catalog and leaves a name that is already there
  alone: unlike pricing or the context window, a stored name may be the user's own rename. A name
  the user deliberately cleared is therefore filled in again by the next sync. The Models nav
  badge counts that repair on the same rule, so the badge and the button still agree about
  whether there is anything to sync.
- Existing config files are unchanged until the user syncs: `display_name = ""` keeps meaning
  "cleared", and an ordinary save on the Models page preserves it.
