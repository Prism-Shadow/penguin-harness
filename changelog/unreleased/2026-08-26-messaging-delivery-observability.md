# A messaging binding says what it has actually seen

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#505](https://github.com/Prism-Shadow/penguin-harness/pull/505)

[中文版](2026-08-26-messaging-delivery-observability.zh.md)

"I sent the bot a message and nothing happened" had three completely different causes and one
appearance. The channel may never have delivered the message; it may have arrived and the Task
failed to start, which the bridge swallowed into an error record; or the Task may have run and the
reply failed to send. All three end as silence in the chat, and the binding panel showed
`connected` with nothing else to say in every one of them.

## The runtime status reports the traffic, not just the socket

`MessagingRuntimeStatus` gains two fields, both filled by the live connection:

- `lastInboundAt` — when this binding last accepted an inbound message. Absent while none has,
  which is the reading that matters: **connected, no error, nothing has ever arrived** is exactly
  what a channel withholding messages looks like, and nothing in the product could say it before.
- `lastDeliveryError` — `{at, stage, detail}` for the most recent failure *after* a message was
  accepted. `stage: "inbound"` means the message arrived and its Task never started;
  `stage: "send"` means the Task ran and its reply never went out. The two lead to different
  places, so the stage is stated rather than folded into one message.
- `lastConnectionError` — `{at, detail}` for the most recent connection failure, **kept after
  the connection recovers**. `lastError` belongs to the `error` state and is wiped the moment
  the state leaves it, so a connector that flaps — which is what a second program taking turns
  on the same bot token produces — reads as `connected` in every snapshot taken between its
  failures, leaving the reader a symptom and no cause.

Both are in-process and start empty on every server start: they are the live connection's own
observations, and the panel's empty case says so rather than claiming a message never arrived.

The binding panel renders them under the connection toggle, beside the existing connection-error
line, in both languages.

## Messaging errors are filed under their Project

`MessagingBridge` recorded every failure with a `sessionId` and nothing else. `GET
/api/projects/:id/usage/errors` selects by project, and a record with no project is
*unattributed* — served only to admins. An ordinary member could therefore never see a failure of
their own binding anywhere in the product. Each record now carries the Session's `projectId` and
`agentId`, read from the sessions index the bridge already holds.

## A Telegram troubleshooting entry for "still nothing from the group"

Beside the Group Privacy entry: when the panel keeps saying no message has arrived, Telegram is
not delivering it and nothing local will change that. The entry names the checks — the bot is
still in the group, a Group Privacy change needs the bot removed and re-added because an existing
group does not pick it up, and nothing else is polling the same token — and states that Telegram
**channel** posts are not supported, this connection handling groups and direct chats only.

The one-program-per-token entry now names the trap that costs the most time while diagnosing
exactly this: **a `getUpdates` run by hand is that other program.** It has to be run with the
connection disabled, and reading updates by hand confirms them, so the app will never see those
messages and a retest needs a freshly sent one.
