# The send-to-background action waits ten seconds, and the background mark shares its slot

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `web`

[中文版](2026-09-14-background-action-delay.zh.md)

## What changed

- The **Send to background** action on a running `exec_command` / `run_subagent` row appears only once the call has been executing for ten seconds. A command that returns in a few seconds used to flash the action and take it away again, so the row's right end jumped with every short call; now it stays still, and the action shows where waiting has actually begun.
- The `[Background]` mark a backgrounded call wears sits at the row's right end, in the very slot the action occupies (before the expand chevron), instead of after the duration. The two never show together, so clicking the action leaves the mark in its place and the row's right end holds one right-aligned thing.
