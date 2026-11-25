# A follow-up round left running by input_subagent reports its completion

- **Date:** 2026-11-25
- **Type:** fix
- **Scope:** `core`
- **PR:** [#1864](https://github.com/Prism-Shadow/penguin-harness/pull/1864)
- **Issue:** [#1861](https://github.com/Prism-Shadow/penguin-harness/issues/1861)

[中文版](2026-11-25-input-subagent-done-report.zh.md)

A follow-up round that `input_subagent` started and that was still running when the call's window ended went on in the background with nothing attached to it. The parent Session heard nothing when the round finished, unless the child had been launched with `run_in_background` and had kept its slot ever since. A child resumed after its slot was freed, and a child that had only ever been polled, both finished in silence. Such a round now gets what a background launch gets.

## Details

- When `input_subagent` returns with the round it started still running, the child receives a completion report, a standing approval sink and a live message tap. The parent Session gets a `[background_task_done]` message when the round settles, the child's messages keep streaming to the frontend, and an approval the child asks for reaches the user without waiting for the next poll.
- The report names the follow-up prompt of the round that finished, not the prompt the child was first launched with.
- The call's note says the completion will arrive as a user message, and no longer asks the model to poll for a pending approval that the standing sink already carries.
- A follow-up round that settles inside the window stays the call's own result: a child that carried no report before the call gets no notice for it. Polling with an empty prompt, steering a running round and `abort` attach nothing.
- `run_subagent`'s background launch and its detached foreground run attach the same three things through one shared helper, with unchanged behaviour.
