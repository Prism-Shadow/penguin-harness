# Company proposals: a proposal's brief can be rewritten

- **Date:** 2026-09-27
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[中文版](2026-09-27-proposal-brief-rewrite.zh.md)

A proposal's brief was fixed at creation: the queue kept showing the delegation it was started with even when that was a set of instructions ("write a proposal for the open PR …") rather than a summary of what is proposed, and the only way to change it was to start the proposal again, losing its comments and events. The author or a person can now rewrite it in place.

## Details

- `penguin org proposal brief <n> -m <text>` (or `--file <f>`, exactly one of the two) rewrites the brief; `PUT /api/projects/:projectId/organizations/:orgId/proposals/:number/brief` with `{ brief }` is the route behind it. Only the author or a person may (403 `not_author`); an empty brief is a 400, the same words as now a 409 `brief_unchanged`.
- Only the brief moves: the revisions, the title, the comments, the events and any approval stand, so it is allowed in every status. The ledger records it as a `brief` line, and the timeline as a `brief_edited` event with the new brief under it ("rewrote the brief"); `show` prints the new brief and the event.
- The author's desk gets one `[proposal #<n>]` line when someone else rewrites the brief of a proposal it is still drafting; past drafting, and for the author's own rewrite, nobody is told.
- The `proposal-author` skill lists the command (`agent-company-proposals` 2026.09.27.3).
- A build without this change reading a ledger that has `brief` lines skips them and shows the brief the proposal was created with; nothing on disk is rewritten.
