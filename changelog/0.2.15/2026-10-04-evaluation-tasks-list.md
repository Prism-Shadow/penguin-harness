# The Evaluations folder holds only the Test Sessions an agent starts

- **Date:** 2026-10-04
- **Type:** fix
- **Scope:** `web`, `docs`
- **PR:** [#969](https://github.com/Prism-Shadow/penguin-harness/pull/969)

[中文版](2026-10-04-evaluation-tasks-list.zh.md)

The conversation that **Use** opens on the **Evaluate** or **Optimize** tab of the Evaluation Center was made an ordinary conversation, listed with the agent that carries the work out, instead of being filed under the **Evaluations** folder of the session list. The folder was left to the Test Sessions an agent starts through `penguin run --source benchmark`.

## Details

- The **Use** dialog stopped marking the conversation it prefills, and the new-chat draft stopped sending the mark as `source` when it creates the Session. A draft an earlier release had saved with the mark creates an ordinary Session too.
- Conversations created before this change keep `source: "benchmark"` in their Trace and stay in the **Evaluations** folder.
- The server and the CLI were not changed: `POST …/sessions` still accepts `source: "benchmark"`, which `penguin run --source benchmark` sends for every Test Session.
- The Evaluation Center, Chat and Server API docs were updated to match.
