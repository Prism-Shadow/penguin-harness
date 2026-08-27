# Group messages reach the model as what the user wrote, not as mention placeholders

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`
- **PR:** [#497](https://github.com/Prism-Shadow/penguin-harness/pull/497)

[中文版](2026-08-26-messaging-inbound-mentions.zh.md)

Addressing a bot in a group means mentioning it, so nearly every group message a binding
receives carries an `@`. Neither channel handed that to the model in a usable form: Feishu writes
a placeholder the model cannot resolve, and Telegram leaves the bot's own handle in front of the
sentence. A Session driven from a Feishu group answered `我看到你发的是 @_user_1 你好，但我不太确定
_user_1 指的是谁或什么` — a whole turn spent on a token that was never part of the message.

## Feishu: placeholders become names

Feishu's `im.message.receive_v1` puts `@_user_1` in the content JSON's `text` and carries the real
identity in a parallel `mentions` array the connector did not read. That array now rides
`FeishuInboundEvent`, and every placeholder is replaced with the mentioned party's name before the
text reaches the Session.

Substitution is one left-to-right pass over the original text, its keys ordered longest first. Two
problems called for that. Feishu numbers placeholders from 1 upward, so `@_user_1` is a literal
prefix of `@_user_10`. And a pass per key re-scans what the earlier passes wrote, which let a
display name that reads like a placeholder be replaced a second time. Each key is substituted at
its first occurrence only — Feishu emits exactly one placeholder per key, so anything further along
that spells the same key is a token the user typed by hand, and it reaches the model as typed.

The bot's identity comes from one `/open-apis/bot/v3/info` lookup per connection, and that lookup
was moved off the connect path onto a background promise. Every enabled binding connects while the
server boots, before the HTTP listener binds; a Feishu endpoint that accepts TCP and then never
answers — a stalled proxy, a blackholing firewall — would otherwise have held the whole server down
on a best-effort display-name lookup. Until the answer lands, and when the app cannot report an
identity at all, this bot's mention is named like everyone else's.

## Telegram: the bot's own handle is stripped

The bot's `@username` is already known from the `getMe` the poll loop makes before every up-streak.
An opening `mention` entity of its own (matched case-insensitively) or `text_mention` entity
(matched by user id) is cut off the front of the text, and what remains is trimmed — the same
whitespace policy the Feishu side applies to its own placeholder. Entity offsets are UTF-16 code
units, which is what a JavaScript string index already is, so an emoji ahead of the handle or inside
a linked display name does not shift the cut.

## Only the addressing prefix is dropped

A mention counts as addressing only when the message opens with it. This bot named further in —
"what is @thisbot's status?", "summarize what @thisbot said yesterday", a Feishu placeholder for it
standing mid-sentence — is a word the user chose, and it stays: on Telegram as the handle the user
typed, on Feishu as this bot's name, exactly like anyone else's mention. Cutting those left the
model a sentence with a hole in it ("what is 's status?"), which is worse than naming the channel
the message came through.

## A message with no words starts no Task

A message left with nothing but mentions — someone `@`-ed the bot and typed nothing else — now
takes the same branch a sticker does, answering with the text-only notice instead of starting a
run on a bare placeholder. On Feishu the emptiness is judged with every placeholder removed, not
only this bot's, so it holds whether or not the bot's identity resolved.
