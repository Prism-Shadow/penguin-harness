# Company proposals: discuss a proposal with its owner

- **Date:** 2026-09-28
- **Type:** feature
- **Scope:** `server`, `web`, `cli`, `plugins`
- **PR:** [#825](https://github.com/Prism-Shadow/penguin-harness/pull/825)

[中文版](2026-09-28-proposal-discussion.zh.md)

The proposal page has a Discuss button. It opens a session of the proposal's owner — the implementer once one is named, else the author — to talk the proposal over, apart from the owner's desk; when the two agree, the conclusion is delivered to the desk once.

## Details

- The session is opened the way an implementation session is: the owner's Agent, its model (else the organization's), its desk Workspace, the organization's approval mode, marked as the organization's. Its first input names the proposal (`proposal:<n>`, the organization, the revision) and carries the proposal's text, or its brief when nothing is published yet.
- `penguin org proposal conclude <n> -m <text>`, run inside the discussion, sends the conclusion to the owner's desk as one `[proposal #<n>]` line; a person can conclude it too, with `--discussion <session_id>`. The route is `POST …/proposals/:number/discussions/:sessionId/conclude` with `{ text }`; opening is `POST …/proposals/:number/discussions` (a person only).
- A discussion concludes once (409 `discussion_concluded`); the owner's desk and other employees cannot conclude it (403 `not_discussion`). A desk that cannot take the conclusion (409 `org_paused`, `employee_paused`, `desk_unavailable`) answers with that reason, records a `notify_failed` event, and leaves the discussion open to be concluded again.
- No discussion opens on a merged or rejected proposal (409 `proposal_status`), in a paused organization (409 `org_paused`), or when the owner is no longer an employee (409 `owner_unavailable`).
- The page lists the discussions (open, or conclusion sent) with a link to each session; the timeline shows `discussion_started` and `discussion_concluded`, the conclusion under the line.
- A build without this change reading a ledger with `discussion` lines skips them; nothing on disk is rewritten.
