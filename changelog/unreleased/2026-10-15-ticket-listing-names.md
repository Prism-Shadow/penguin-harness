# A ticket column lists only the files named by a ticket id

- **Date:** 2026-10-15
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1141](https://github.com/Prism-Shadow/penguin-harness/pull/1141)
- **Issue:** [#735](https://github.com/Prism-Shadow/penguin-harness/issues/735)

[中文版](2026-10-15-ticket-listing-names.zh.md)

A ticket column now contributes only the `.md` files whose names are ticket ids. Every other
file in a column is left alone: a stray `README.md` reaches no board row, counts toward no
spend, and records no `org_ticket_invalid` error on each pass.

## Details

- `isTicketId` (`packages/server/src/organization/files.ts`) accepts both id shapes — the current
  one, and the one written before the slug rule tightened, declared beside it as
  `LEGACY_TICKET_ID_PATTERN`. A ticket whose slug carries digits therefore still shows on the
  board, and the read and write routes keep refusing it exactly as they did.
- `OrgStore.listTickets` filters the basename it derives from a file name before it reads the
  file, so a file that is not a ticket costs no parse and no error entry. The method's doc
  comment states the rule.
