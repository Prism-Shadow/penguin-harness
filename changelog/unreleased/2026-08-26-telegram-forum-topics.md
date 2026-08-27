# Replies stay in the Telegram forum topic they were asked in

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`

[中文版](2026-08-26-telegram-forum-topics.zh.md)

A forum supergroup splits one chat into topics, and every message carries the topic it was
written in. Only the first reply of a run stayed there — Telegram infers a reply's topic from the
message it quotes — while everything after it walked out of the conversation into **General**:
the run's later completed messages, every chunk after the first of a long one, the
tool-approval notice, and the test message. Half an answer arrived where it was asked for and the
rest turned up somewhere else.

## The topic rides the chat id

`messaging_bindings.last_chat_id` now stores `<chat id>:<topic id>` for a message written in a
topic, and the bare chat id for everything else. `MessagingInboundMessage.chatId` was already
opaque to the bridge in the way `messageId` is — the connector mints it and the connector consumes
it in `sendText` — so the topic reaches every outbound path without the channel-neutral seam, the
repo or the schema learning what a forum topic is, and it survives a restart in the column that
already persists the chat.

The binding remembers the **most recent** topic, matching what it already does with the chat
itself: a user who moves to a new topic gets the replies there.

Reply refs gained the same optional component. A reply normally inherits its target's topic, but
`allow_sending_without_reply` degrades a vanished target to a plain send — which would have landed
in General precisely when the conversation could least spare it.

Every chat id written before this parses as itself: no separator means no topic, which is also
what an ordinary group and a forum's General topic are.

## A deleted topic degrades instead of losing the reply

The Bot API has no `allow_sending_without_thread` to match the reply flag, so a send into a topic
that has since been deleted or closed simply fails. Such a send is retried once without the topic:
General is worse than the right place and far better than dropping an answer the model has already
produced. The retry is keyed on a topic having been attached, not on Telegram's error wording, and
a send that carried no topic is never retried — so a genuine failure still surfaces as
`messaging_send_failed` rather than being turned into a second delivery attempt.
