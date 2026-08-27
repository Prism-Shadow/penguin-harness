# A messaging binding says what it has actually seen

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `server`, `web`
- **PR:** [#505](https://github.com/Prism-Shadow/penguin-harness/pull/505)

[中文版](2026-08-26-messaging-delivery-observability.zh.md)

"I sent the bot a message and nothing happened" had three completely different causes and one
appearance. The channel may never have delivered the message; it may have arrived and the Task
failed to start, which the bridge swallowed into an error record; or the Task may have run and the
reply failed to send. All three ended as silence in the chat, and the binding panel showed
`connected` with nothing else to say in every one of them.

## The runtime status was given the traffic, not just the socket

`MessagingRuntimeStatus` gained three fields, all filled by the live connection:

- `lastInboundAt` — when the binding last accepted an inbound message. Absent while none had,
  which was the reading worth adding: **connected, no error, nothing arriving** is exactly what a
  channel withholding messages looks like, and nothing in the product could say it.
- `lastDeliveryError` — `{at, stage, detail}` for the most recent failure *after* a message was
  accepted. `stage: "inbound"` means the message arrived and its Task never started;
  `stage: "send"` means the Task ran and its reply never went out. The two lead to different
  places, so the stage was stated rather than folded into one message. No later success clears
  it — an intermittent failure would otherwise be erased by the next ordinary message — so the
  panel line carries the failure's own time and a stale one reads as stale.
- `lastConnectionError` — `{at, detail}` for the most recent connection failure, **kept after the
  connection recovers**. `lastError` belongs to the `error` state and is wiped the moment the
  state leaves it, so a connector that flaps — which is what a second program taking turns on the
  same bot token produces — read as `connected` in every snapshot taken between its failures,
  leaving the reader a symptom and no cause.

All three were kept in process and scoped to one CONNECTION, not to one server run: each starts
empty on a (re)connect, and a re-enable or a credential save opens one. The copy was written to
that scope — the empty arrival line reads "no message has arrived since this connection opened"
rather than claiming none ever did, and the troubleshooting entry below treats it as evidence only
about a message sent after reading it.

The binding panel took all three under the connection toggle, beside the existing connection-error
line, in both languages. The arrival line was deliberately not gated on `connected`: it reports
traffic rather than the socket, and `connecting` and `error` — a bot mid-handshake, a flapping
token — are where a reader most needs to know whether this bot has been receiving at all.

## Messaging errors were filed under their Project

`MessagingBridge` recorded every failure with a `sessionId` and nothing else. `GET
/api/projects/:id/usage/errors` selects by project, and a record with no project is
*unattributed* — served only to admins. An ordinary member could therefore never see a failure of
their own binding anywhere in the product. Each record was given the Session's `projectId` and
`agentId`, read from the sessions index the bridge already held.

## A Telegram troubleshooting entry for "still nothing from the group"

Added beside the Group Privacy entry: how to read the arrival line, and what to check once it has
been read properly. It states that the line covers the current connection alone, so a retest means
sending a fresh message rather than trusting a line that a re-enable just reset — and that if that
fresh message still shows nothing, Telegram is not delivering it and nothing local will change
that. It names the checks: the bot is still in the group, a Group Privacy change needs the bot
removed and re-added because an existing group does not pick it up, and nothing else is polling the
same token. It also states that Telegram **channel** posts are not supported, this connection
handling groups and direct chats only.

The one-program-per-token entry gained the trap that costs the most time while diagnosing exactly
this: **a `getUpdates` run by hand is that other program.** It has to be run with the connection
disabled, and inspecting the backlog by hand can discard it — any call carrying an `offset`
confirms everything before it, and the connector's own next connect drops the backlog — so a
retest needs a freshly sent message.
