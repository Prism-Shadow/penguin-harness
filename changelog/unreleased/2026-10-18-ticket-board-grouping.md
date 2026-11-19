# The ticket board groups, filters and sorts its columns

- **Date:** 2026-10-18
- **Type:** feat
- **Scope:** `web`
- **PR:** [#1202](https://github.com/Prism-Shadow/penguin-harness/pull/1202)

[中文版](2026-10-18-ticket-board-grouping.zh.md)

The company ticket board grew a toolbar above its columns: quick-filter chips (all / awaiting
review / blocked / overdue / mine) each carrying the count it would leave, the search box, the
priority chips, the column grouping and the column order. A column groups its cards by owner,
priority or parent ticket (or stays flat), and orders them by priority, by due date or by how
long they have been waiting; both choices persist in the address (`?group=`, `?sort=`,
`?quick=`), and the old `?blocked=1` / `?queue=approve` deep links still read as the chips of
the same name.

Also new: select mode with a bulk bar (move / assign / note, with a reason required for a move
into Rejected), an approval queue that hangs Approve / Reject under each card awaiting review,
columns that scroll under their own headers so the five stay side by side, and two plain keys —
`/` focuses the search, `N` opens the create form, Escape leaves select mode then clears the
search.

## Details

- `groupTickets` gains the grouping and the three orders as pure, unit-tested functions; the
  page's own keys move to `lib/shortcuts/page-keys.ts`, which reads bare keys only — every
  chord stays in the shortcut registry the settings page can see.
