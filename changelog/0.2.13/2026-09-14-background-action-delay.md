# The send-to-background action waits ten seconds, and the background mark shares its slot

- **Date:** 2026-09-14
- **Type:** fix
- **Scope:** `core`, `web`, `docs`
- **PR:** [#721](https://github.com/Prism-Shadow/penguin-harness/pull/721)

[中文版](2026-09-14-background-action-delay.zh.md)

## What changed

- The **Send to background** action on a running `exec_command` / `run_subagent` row appears only once the call has been executing for ten seconds. A command that returns in a few seconds used to flash the action and take it away again, so the row's right end jumped with every short call; now it stays still, and the action shows where waiting has actually begun.
- The `[Background]` mark a backgrounded call wears sits at the row's right end, in the very slot the action occupies (before the expand chevron), instead of after the duration. The two never show together, so clicking the action leaves the mark in its place and the row's right end holds one right-aligned thing.
- The note a moved call returns to the model now says plainly not to follow it up: leave the work running unattended, no polling and no input, move on to other work or end the turn, the completion arrives on its own as a `[background_task_done]` message. A model used to answer the move by opening `input_command` on the very process the user had just parked.
