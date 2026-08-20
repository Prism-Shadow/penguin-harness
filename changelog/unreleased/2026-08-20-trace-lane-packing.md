# Trace timeline packs same-name tool calls into shared rows

- **Date:** 2026-08-20
- **Type:** feature
- **Scope:** `web`
- **PR:** [#362](https://github.com/Prism-Shadow/penguin-harness/pull/362)

[中文版](2026-08-20-trace-lane-packing.zh.md)

Shortened the trace observation timeline: tool-call executions with the same tool name whose time ranges don't overlap now share one row instead of taking one row each, so a burst of serial calls to the same tool (a long `exec_command` or `read_file` sequence) collapses from N rows to one. Only a different tool name, or same-name calls that overlap in time (parallel execution), still open extra rows.

## Details

- Packing is greedy first-fit per tool name (`lane-packing.ts`): calls are placed in start order into the first row of their name that is free at that moment; touching endpoints don't count as overlap. Rows never mix tool names, rows of one name stay adjacent, and names are ordered by their earliest call.
- A still-running call keeps its row blocked until the task end, so later calls of the same name open a new row rather than drawing over it.
- Bar rendering, hover/click highlighting, event-list linkage, and zoom/pan behavior were left unchanged; only the row assignment changed.
