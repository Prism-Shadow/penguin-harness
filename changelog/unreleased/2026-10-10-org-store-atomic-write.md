# The organization store writes atomically and keeps a ticket a crash left in two columns

- **Date:** 2026-10-10
- **Type:** fix
- **Scope:** `server`
- **PR:** [#850](https://github.com/Prism-Shadow/penguin-harness/pull/850)

[中文版](2026-10-10-org-store-atomic-write.zh.md)

Every file the organization store writes — `org_config.toml`, `org_chart.yaml`, tickets, channels, calendar events, the handbook — now goes through the core's `atomicWriteFile`, a uniquely named temp file renamed into place, so a crash mid-write cannot leave a truncated file that reconcile would report as invalid and drop from the board. `moveTicket` no longer swallows a failed removal of the old column's file; only an already-missing file passes. A ticket id found in two columns — a crash between the move's write and its unlink — keeps its newest copy on the board, and the stale copy is reported under invalid files instead of both copies disappearing.
