# Replies stay in the Telegram forum topic they were asked in

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#507](https://github.com/Prism-Shadow/penguin-harness/pull/507)

[中文版](2026-08-26-telegram-forum-topics.zh.md)

A forum supergroup splits one chat into topics, and every message carries the topic it was
written in. Only the first reply of a run stayed there — Telegram infers a reply's topic from the
message it quotes — while everything after it walked out of the conversation into **General**:
the run's later completed messages, every chunk after the first of a long one, the
tool-approval notice, and the test message. Half an answer arrived where it was asked for and the
rest turned up somewhere else.

## The topic rides the chat id

The topic was packed into `messaging_bindings.last_chat_id` as `<chat id>:<topic id>`, leaving the
bare chat id for every message written outside one. `MessagingInboundMessage.chatId` was already
opaque to the bridge in the way `messageId` is — the connector mints it and the connector consumes
it in `sendText` — so the topic reached every outbound path without the channel-neutral seam, the
repo or the schema learning what a forum topic is, and it crossed a restart in the column that
already stored the chat.

The binding was given the **most recent** topic, matching what it already did with the chat
itself: a user who moves to a new topic gets the replies there.

Reply refs gained the same optional component, because `allow_sending_without_reply` degrades a
vanished reply target to a plain send, which would have dropped the topic along with it.

Rows written before this change need nothing done to them — see
[backward compatibility](2026-08-27-backward-compatibility.md).

## Only a real forum topic is remembered

Telegram sets a message's `message_thread_id` on an ordinary reply chain too — in a private chat,
and in a supergroup that is no forum — while `sendMessage` takes the parameter for forum
supergroups only, and refuses anything else with `Bad Request: message thread not found`. A topic
was therefore minted only from a message whose chat reports `is_forum` and which itself reports
`is_topic_message`. Everywhere else the refs stayed bare chat and message ids, and an outbound
message stayed the single request it always was.

## A deleted topic degrades instead of losing the reply

The Bot API has no `allow_sending_without_thread` to match the reply flag, so a send into a topic
that has since been deleted or closed fails with a `400`. Such a send was retried once without the
topic, which puts the message in General. Only a `400` is retried, and only when a topic was
attached: a flood wait would be lengthened by an immediate second request, and a transport failure
carries no answer from Telegram at all, so the message it was sent for may already have arrived. A
send that carried no topic is never retried, and a genuine failure still surfaces as
`messaging_send_failed`. A reply that reached General this way is logged, once per episode rather
than once per message.

## One reply, one place

A reply's two halves — the chat it goes to, and the inbound message its first chunk quotes — were
snapshotted together before the first send, instead of one of them being re-read for every chunk.
A message arriving in a second topic mid-delivery had been able to move them apart, splitting one
reply between two topics.
