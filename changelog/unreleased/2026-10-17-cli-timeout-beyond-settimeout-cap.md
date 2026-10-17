# Waiting beyond the setTimeout cap no longer ends on the spot

- **Date:** 2026-10-17
- **Type:** fix
- **Scope:** `cli`
- **PR:** [#1180](https://github.com/Prism-Shadow/penguin-harness/pull/1180)

[中文版](2026-10-17-cli-timeout-beyond-settimeout-cap.zh.md)

`run --timeout`, `input --timeout` and `logs -f --timeout` used to end immediately — printing the detach note and exiting 0 — when the budget worked out past 2^31-1 ms (about 596 hours): `nextFrameOrDeadline` handed the whole remaining wait to a single `setTimeout`, and Node clamps such a delay to 1. The timer is now held just under the cap and re-armed until the deadline arrives, so any budget the duration parser accepts waits as long as it says.

## Details

- Covered by `packages/cli/test/server-task-timeout.test.ts`, which fails against the single-timer version.
