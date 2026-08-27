# A redelivered chat message survives a server restart without running twice

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#493](https://github.com/Prism-Shadow/penguin-harness/pull/493)

[中文版](2026-08-26-messaging-inbound-watermark.zh.md)

The messaging bridge drops an inbound message its binding has already processed, so a channel
replaying an event does not start the same Task again. That memory was in process only: a
desktop-app relaunch or a runtime hot swap emptied it, and a channel replaying across the restart
— which is what a channel does the moment a connection opens — ran the message a second time. The
Session then answered twice, in the chat and in the Web App.

## The watermark on the binding row

`messaging_bindings` gains `last_inbound_message_id`: the channel id of the most recently processed
inbound message. It is written by the `UPDATE` that already records the message's chat as the
binding's reply target, on every inbound message, so it costs one bound parameter and no statement
of its own.

`MessagingBridge` folds the stored id back into the binding's in-memory ring when a connection
opens, before the stream can deliver anything. The two are one memory rather than two guards: the
ring holds the last 64 ids for as long as the process lives, the row holds the last one for as
long as the binding does.

The row remembers one id, so a channel replaying a whole burst across a restart is only guaranteed
to have its most recent event recognized. A connector acknowledges each event as it finishes with
it, so at most the one in flight when the process ended is still owed.

Re-saving a binding onto a **different** bot account clears the watermark along with the remembered
chat, as the other account's message ids mean nothing to the new one.

## The dedupe memory no longer expires by age

The in-memory ring bounded itself by count *and* by a ten-minute age. The age bound existed to
tolerate a channel that reuses message ids; neither channel does — Feishu's `om_*` are globally
unique, and Telegram's key is `chatId:message_id`, whose counter only climbs. With no reuse to
guard against, expiry could only forget a redelivery still owed, and a channel resuming a stream
after a long outage replays what it never saw acknowledged, however much later that is. The count
bound stays and is what keeps the memory from growing.

## Compatibility

The added column is covered by the batch's
[backward-compatibility entry](2026-08-26-backward-compatibility.md). No action is required.
