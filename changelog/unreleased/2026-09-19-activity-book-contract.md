# Validate book page structure and media

- **Date:** 2026-09-19
- **Type:** fix
- **Scope:** `server`
- **PR:** [#22](https://github.com/nicolaepocroianu/penguin-harness/pull/22)

Book specification saves and new module requests gained page-order and media validation. Invalid candidates retained their reviewable output without replacing the saved specification. Book generation instructions added explicit page roles, one image per page, and ordered narration cues.

Existing stored drafts remained readable without rewriting their contents or revisions. New saves and module requests applied the book checks and reported actionable errors for invalid pages. Standard activities retained their generic specification contract.
