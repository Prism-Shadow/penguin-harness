# Interrupt joins Steer and Queue as a mid-run send mode

- **Date:** 2026-11-02
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#1421](https://github.com/Prism-Shadow/penguin-harness/pull/1421)

[中文版](2026-11-02-interrupt-send.zh.md)

The composer's mid-run send mode now has a third choice beside Steer (the default) and Queue: Interrupt. Sending in this mode stops the run and sends the message right after the turn it cut. What the cut turn had produced goes out ahead of it, the way the next message after Stop always carried it, so the committed history is unchanged and its prompt cache still hits. Steering that had not been delivered yet comes back to the input box, as it does on Stop.

## Details

- `POST /api/sessions/:id/tasks` accepts `interrupt: true`. On a busy Session the message goes to the head of the follow-up queue, behind any earlier interrupt (the queue's cap still applies), and the run is aborted the way `POST /abort` aborts it. Messages queued before it still go out, after it. An idle Session just starts the Task. Combining it with `queueIfBusy` or `goal` is a 400.
- `POST /api/sessions/:id/interrupt` sends one waiting message now: the queued follow-up `followUpId` names (it keeps its id), or the undelivered steering message `steerId` names. Once that message is no longer waiting it answers 409 `follow_up_started` or `not_pending`.
- While the stopped run winds down, the interrupt waits in the queue mirror with `interrupt: true`. The composer shows it as an "Interrupting — sent next" line, and it can be recalled like any queued message.
- Every queued follow-up line and every queued steering line gets an Interrupt text link before the recall control.
