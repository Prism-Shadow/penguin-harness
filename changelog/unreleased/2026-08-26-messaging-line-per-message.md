# A messaging reply can arrive one message per line

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#494](https://github.com/Prism-Shadow/penguin-harness/pull/494)

[中文版](2026-08-26-messaging-line-per-message.zh.md)

A relayed assistant reply reached the chat as one message, however it was written. A per-binding
option now delivers it as one message per non-blank line instead — the shape a role-play answer
written as several spoken lines is meant to arrive in. Off by default, and off is byte-for-byte
the previous behaviour.

## Details

- The option is stored as `messaging_bindings.line_per_message`, a column beside `enabled` rather
  than a key inside `config_json`: that document is the channel's own credential shape, owned by
  its connector, while this applies to every channel identically.
- `linePerMessage` joined `FeishuBindingInfo` / `TelegramBindingInfo` and both PUT bodies. It is
  an ordinary form field applied on Save — no route of its own — and an omitted value keeps the
  stored one; a new binding starts with it off.
- Splitting is deliberately literal: every non-blank line becomes its own message, fenced code
  blocks included, blank lines are dropped and each line is trimmed. Each resulting message still
  goes through the channel's size chunking, so a single line over the cap is split rather than
  rejected.
- One reply may become at most `MESSAGING_MAX_LINE_MESSAGES` (20) messages, a number taken from
  the tightest channel's per-chat burst allowance — Telegram answers 429 to roughly 20 messages a
  minute in one chat. Past it the remaining lines are combined into one final message rather than
  dropped.
- The group-chat rule is unchanged: the run's first outbound message threads onto the inbound one
  and everything after it is a plain send, so many lines do not become many quote headers. The
  option applies only to relayed assistant replies — never to the approval notice, the text-only
  notice or the test message.
- In the binding editor the option closes the form as a `Switch` for both channels, saved by the
  existing Save action, with its explanation behind the "?" beside its label.
