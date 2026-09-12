# A test pins that a subagent's completion notice ends no sibling

- **Date:** 2026-09-12
- **Type:** process
- **Scope:** `core`
- **PR:** [#708](https://github.com/Prism-Shadow/penguin-harness/pull/708)
- **Issue:** [#581](https://github.com/Prism-Shadow/penguin-harness/issues/581)

[中文版](2026-09-12-sibling-subagents-survive-notice.zh.md)

The core suite gained one test for the report that a background subagent's completion notice interrupted the other subagents still running: three `run_in_background` children on one Session, one of them settling while the Session is idle and another while a Task runs. On both delivery paths the notice reaches the model as input only, the host is signaled on the idle path alone, and the remaining children keep running until they finish on their own with `completed`.

## Details

- The test drives the real `Environment`, `Session` and subagent tools with a scripted runner whose children answer when released, so the timing of each completion is exact.
- No runtime code changed: every path that can end a background child's run was read against the report and none is reached by a sibling's notice.
