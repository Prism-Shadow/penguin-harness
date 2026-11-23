# Removing a Session stops its subagent children and waits for their last writes

- **Date:** 2026-11-16
- **Type:** fix
- **Scope:** `core`, `server`
- **PR:** [#1360](https://github.com/Prism-Shadow/penguin-harness/pull/1360)

[中文版](2026-11-16-session-removal-subagents.zh.md)

Deleting a Session, an Agent or a Project, and shutting the server down, stopped the runtime's subagent children as soon as the removal began, instead of after the main Task's interrupt cleanup had settled. The wait the deletion already had (at most five seconds) then covered the children's cancellation writes as well, so a child still writing its abort records no longer recreated its deleted Trace. A child the parent's stop had already cancelled was waited for too. Stopping only the main Task still left background children running.

## Details

- `Session.dispose()` and the Environment's `dispose()` returned a promise that resolved once every subagent child had finished writing; a child handle's `dispose()` could return one as well.
- A message to a subagent child loaded its parent Session under the same per-Session lock as a Task, so the two arriving together no longer built two runtimes, one of which escaped the Session's deletion.
- A Session deleted while its runtime was loading was no longer loaded back.
- Usage reported after a Project's deletion, past the deletion's wait, was no longer recorded.
