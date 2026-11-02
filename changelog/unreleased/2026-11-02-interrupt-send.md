# Interrupt joins Steer and Queue as a mid-run send mode

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1421](https://github.com/Prism-Shadow/penguin-harness/pull/1421)

[中文版](2026-11-02-interrupt-send.zh.md)

The composer's mid-run send mode now has a third choice beside Steer (the default) and Queue: Interrupt. Sending in this mode stops the run and sends the message right after the turn it cut. What the cut turn had produced goes out ahead of it, the way the next message after Stop always carried it, so the committed history is unchanged and its prompt cache still hits. Steering that had not been delivered yet goes out with the message instead of coming back to the input box.

## Details

- `POST /api/sessions/:id/tasks` accepts `interrupt: true`. On a busy Session the message goes to the head of the follow-up queue, behind any earlier interrupt and outside the queue cap, and the run is aborted the way `POST /abort` aborts it. Messages queued before it still go out, after it. An idle Session just starts the Task. Combining it with `queueIfBusy` or `goal` is a 400.
- `POST /api/sessions/:id/interrupt` turns what is already waiting into an interrupt: the follow-up named by `followUpId`, or all undelivered steering when no id is given. If nothing is left to send that way it answers 409 `follow_up_started` or `not_pending`.
- While the stopped run winds down, the interrupt waits in the queue mirror with `interrupt: true`. The composer shows it as an "Interrupting — sent next" line, and it can be recalled like any queued message.
- Every queued follow-up line and the last queued steering line get an Interrupt text link before the recall control.
