# Sidebar: one "Show N more chats" row per list, time grouping included

- **Date:** 2026-10-13
- **Type:** fix
- **Scope:** `web`, `docs`
- **PR:** [#1090](https://github.com/Prism-Shadow/penguin-harness/pull/1090)

[中文版](2026-10-13-sidebar-one-reveal-row.zh.md)

Grouped by time, the conversation list showed two paging rows at once: each period's **Show N more chats** and a **Load more chats** row under the whole list. It now has one, the same row the Workspace and Agent groups use.

## Details

- In time grouping the three periods (**Past day**, **Past month**, **Earlier**) are one list. Ten conversations show in all, newest period first, and a single **Show N more chats** row below the last period reveals ten more per click, fetching the next page from the server when the loaded rows run out. A period the list has not reached yet is not drawn.
- N counts every conversation of the Project that the list does not show yet, from the server's per-agent totals, so it includes the ones not fetched yet.
- A folded period does not count toward the ten: the next conversations come into view below it, and N leaves out the rows behind the fold.
- **Show less** folds the list back to its first ten, as it does for a group.
- Each click reveals ten more, counted from the rows on screen: after a fetch that came back short or failed, the next click asks for the same page again.
- The **Load more chats** row and its text are gone.
