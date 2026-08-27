# Group messages reach the model as what the user wrote, not as mention placeholders

- **Date:** 2026-08-26
- **Type:** fix
- **Scope:** `server`

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

Replacement runs longest key first: Feishu numbers placeholders from 1 upward, so `@_user_1` is a
literal prefix of `@_user_10` and event order would corrupt the longer key.

This bot's own mention is removed rather than named, so the message reads as if it had been typed
into the web composer — the model is deliberately not told which channel it arrived through. The
bot's identity comes from one `/open-apis/bot/v3/info` lookup per connection; when the app cannot
report one, its mention is named like everyone else's and the connection opens regardless.

## Telegram: the bot's own handle is stripped

The bot's `@username` is already known from the `getMe` the poll loop makes before every up-streak.
Its own `mention` entities (matched case-insensitively) and `text_mention` entities (matched by
user id) are cut out of the text, back to front so each remaining offset still indexes the same
character, with one separating space swallowed so the cut leaves no gap. Other people's mentions
stay: those are words the user chose and read as themselves.

## A message with no words starts no Task

A message left with nothing but mentions — someone `@`-ed the bot and typed nothing else — now
takes the same branch a sticker does, answering with the text-only notice instead of starting a
run on a bare placeholder. On Feishu the emptiness is judged with every placeholder removed, not
only this bot's, so it holds whether or not the bot's identity resolved.
