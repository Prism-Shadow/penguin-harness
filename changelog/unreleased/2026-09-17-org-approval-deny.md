# An organization's tool call is denied rather than left waiting for a person

- **Date:** 2026-09-17
- **Type:** fix
- **Scope:** `server`, `skills`
- **PR:** [#785](https://github.com/Prism-Shadow/penguin-harness/pull/785)

[中文版](2026-09-17-org-approval-deny.zh.md)

In company mode, a tool call that the organization's approval mode hands to a person is now
denied the moment it is made, instead of suspending the run until somebody answers. Desk,
ticket and the sub-sessions they spawn have nobody watching them, so under `read-only` a
read-write call used to park a work run for good. The employee protocol reads the denial as
the cue to ask the board.

## Details

- The approval callback the server hands to `Session.run` (`makeApprove`, built per Session
  in `SessionManager.entryApprove`) takes an `unattended` reading, re-read per decision like
  the approval mode itself. It is the session row's durable `client = "org"` stamp — every
  session the organization runtime opens, and the sub-sessions that inherit it. When it is
  set, the one route that would wait for a person answers `deny` at once and pushes no
  `approval_request`; the automatic answers (`allow-all`, `deny-all`, `read-only`'s read
  tools) and the command policy's veto are untouched. Development mode's sessions under the
  same approval mode keep suspending for their user.
- The model reads the denial as the existing fixed `aborted` tool output,
  `Tool call denied by user.`; no message type, field or decision value was added.
- `company-employee` (plugin `agent-company` `2026.09.17.2`) says so in "What you may not
  decide alone" and in its unattended caution: a refusal in a desk or ticket session means
  nobody was asked, so it is the cue to ask the board — a channel message to the creator,
  `penguin org ticket block --by user:<id>`, and the end of the run — and never something to
  retry. It also names what a `read-only` organization refuses along the way: the
  `penguin org` commands themselves, which run through a read-write tool.
- Comments in the organization runtime that still named the pre-frontmatter ticket headers
  (`Parent`, `Blocked`, "the header") were rewritten to the frontmatter fields, in
  `company-finance` too, and `OrgStore.listTickets` now describes the files it actually
  lists — it never filtered names by the ticket-id pattern.
