# Company proposals: an employee can reject a proposal

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `cli`, `plugins`
- **PR:** [Myriad-Dreamin/penguin-harness#57](https://github.com/Myriad-Dreamin/penguin-harness/pull/57)

[中文版](2026-09-29-proposal-reject-by-employees.zh.md)

Only a person could reject a proposal. When a person told an employee to take proposals off the queue, the employee could only answer that it was not allowed, and the proposals stayed open until the person rejected each one by hand. Any employee of the organization can now reject a proposal, the same way a person does.

## Details

- `penguin org proposal reject <n> --reason <text>` and `POST /api/projects/:projectId/organizations/:orgId/proposals/:number/reject` with `{ reason }` accept an employee as well as a person. Nothing else about rejecting changed: the reason is required (400 when empty), a merged or rejected proposal answers 409 `proposal_status`, and a caller outside the organization still gets 403.
- The ledger's status line and the `rejected` event record who rejected it (`agent:<id>` or `user:<id>`), so an employee's rejection reads apart from a person's. The author and any implementer get the usual `[proposal #<n>] rejected by <who>: <reason> — stop work on it, and close its PR if one is open.` line; the one who rejected is never told of its own act.
- The CLI's help text no longer says "(a person)".
- The `proposal-author` skill lists the command and says when to use it: when a person tells you to, or when your own proposal should not go on; closing a colleague's proposal on your own judgement goes to a person through `feedback` instead (`agent-company-proposals` 2026.09.29.1).
- No new status, event kind or ledger line: a build without this change reads an employee's rejection like any other.
