# Wait for child cleanup before deleting Session files

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1360](https://github.com/Prism-Shadow/penguin-harness/pull/1360)

[中文版](2026-10-26-subagent-deletion-cleanup.zh.md)

Session deletion included background subagent cancellation cleanup in its existing wait for running work. This prevented a child finishing within that wait from recreating its deleted Trace with cancellation records. Agent and Project deletion, and server shutdown, also awaited child cleanup.

Stopping only the main Task continued to leave background subagents running.

Cancelled children remained owned until cleanup settled, even when listing or looking up live children hid them before background registration.

Cleanup also waited for descendants owned by a resumed child, including when the direct child had already finished its turn.
