# Activity image inspection

- **Date:** 2026-09-19
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#18](https://github.com/nicolaepocroianu/penguin-harness/pull/18)

Activity owners gained inline previews for saved image bindings in the media editor, with pixel dimensions, a full-size view, and retry/reload controls. Previews used the selected WAF checkout and were withheld while the draft had unsaved changes.

Image reads were restricted to the selected activity's saved media binding and current draft revision. The endpoint checked project ownership, rejected linked files and directories, bounded reads to 8 MiB, and served only PNG, JPEG, GIF and WebP content with private, non-cached responses. No stored drafts or database schemas changed.
