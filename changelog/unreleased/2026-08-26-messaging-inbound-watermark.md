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

`messaging_bindings` gained `last_inbound_message_id`: the channel id of the most recently
processed inbound message. `MessagingBridge` folds the stored id back into the binding's in-memory
ring when a connection opens, before the stream can deliver anything. The two are one memory rather
than two guards: the ring holds the last 64 ids for as long as the process lives, the row holds the
last one for as long as the binding does.

The watermark is advanced by an `UPDATE` of its own, issued only once the message has become a Task
— or been answered with the text-only notice. The write that records the message's chat as the
binding's reply target still goes first, because the outbound relay reads that chat; the watermark
could not join it. A busy Session's queued follow-up lives in memory only, so an id persisted ahead
of the work would outlive that work whenever the process died in between, and the seeding above
would then turn the channel's replay into a complete no-op — the message would never run and
nothing would ever answer. A start that threw leaves the id unwritten, and the replay runs the
message instead.

The row remembers one id, which is what Feishu's long connection needs and all it needs: that
stream replays events it never saw acknowledged, and the SDK acknowledges each one only after the
bridge's handler returns, so at most the message in flight when the process ended is still owed.
Telegram redelivers nothing across a restart — its poller advances past an update before handing it
over, and a new connection drains whatever arrived while nothing was connected — so on that channel
the row is carried and never consulted.

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
