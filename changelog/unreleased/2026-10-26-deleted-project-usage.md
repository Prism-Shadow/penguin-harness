# Keep deleted Project usage cleared

- **Date:** 2026-10-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#1364](https://github.com/Prism-Shadow/penguin-harness/pull/1364)

[中文版](2026-10-26-deleted-project-usage.zh.md)

Project deletion cleared its usage history, but a request finishing after the cleanup deadline
could insert new rows for that deleted Project. The usage recorder now checks that the Project
still exists before persisting reported tokens or failed-request rows. This applies to main
Sessions, subagent records and standalone usage such as automatic titles.

Recreating a Project with the same ID starts fresh: late usage from the previous Project is
discarded, while requests belonging to the new Project are recorded normally.

Removing only a Session still preserves its reported usage while the Project exists. The change
does not alter the deletion deadline or estimate provider charges.

Runtime loading now captures the original Project lifetime before credential refresh and rejects results when the Project or Session is removed during loading, releasing the unused runtime.

Concurrent Task and child-message requests shared one runtime load, so a later load could not replace a running Task's owner. Child message dispatch did not hold the Task admission lock.
