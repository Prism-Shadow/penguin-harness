# Interrupting mid-tool-call no longer discards a queued steering message

- **Date:** 2026-09-03
- **Type:** fix
- **Scope:** `server`, `web`

[中文版](2026-09-03-steering-returned-on-interrupt.zh.md)

A message steered into a running Task and still waiting for its next tool round was thrown
away when the run was interrupted, taking the text the user had already typed with it. The
undelivered message is now handed back and returns to the composer, ready to send again.

## Details

- Core drops its steering queue as a run exits, so the server used to drop its mirror with it.
  What is in that mirror when the run ends is exactly what was never delivered — entries leave
  it as their `[user_steering]` message appears on the stream, and the mirror is read after that
  stream is drained — so those entries are now handed back instead of discarded.
- Handed-back entries ride `task_state` events and the SSE subscribe snapshot as
  `returnedSteering`, and the composer takes each one through the same recall channel a queued
  line's button already used: the text returns to the input box, images and file attachments
  are restored with it, and the "steering queued" hint retires.
- A reload restores them too, so a closed tab does not strand the message.
- Entries are not cleared when the next run starts: the message was never delivered whatever
  happens afterwards. Only taking it back — or the runtime entry's idle eviction — removes one.
- Steering delivered before the interrupt is unaffected, and a subagent's undelivered steering
  still ends with its run: it comes from the model or the agents panel, and no composer is
  waiting to take it back.
