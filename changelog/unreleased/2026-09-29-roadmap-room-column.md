# A roadmap's room shows the roadmap in a column the app draws

- **Date:** 2026-09-29
- **Type:** feature
- **Scope:** `web`, `plugins`
- **PR:** [Myriad-Dreamin/penguin-harness#22](https://github.com/Myriad-Dreamin/penguin-harness/pull/22)

[中文版](2026-09-29-roadmap-room-column.zh.md)

The column beside a roadmap's room is now drawn by the web app itself from the company-roadmaps plugin's answer for that roadmap, instead of embedding the plugin's page in its detail view.

## Details

- The items come first, in a list shaped like the proposals queue: a proposal item with a linked proposal is that proposal's row (its number, current title and status, opening the proposal page); an unlinked item shows its stage — draft, a brief waiting for its two approvals (who approved and when, and the person's **Approve** while theirs is missing), or delegated. Proposal items come before derived-roadmap items.
- The moderator, item owners, derived-roadmap employees and employee approvers appear as a face and a name, as on the proposals page, never as an employee id.
- The body follows the items, rendered as Markdown through the channel message pipeline — headings, lists, `proposal:<n>` references as capsules, `@` mentions as names, footnotes as notes — laid directly into the column with no card around it.
- The record is no longer shown in the column; the plugin still keeps and serves it.
- The column is one of the app's own scrollers, so it takes the app's thin scrollbar.
- A roadmap's moderator is told in its room session that the body is shown as Markdown, with `proposal:<n>` for a proposal reference and footnotes for notes.
- The plugin's own roadmaps page (All roadmaps) is unchanged.
