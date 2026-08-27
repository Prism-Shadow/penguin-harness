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
  blocks included; blank lines and trailing whitespace are dropped, and leading indentation is
  kept — an indented code block arrives runnable. Each resulting message still goes through the
  channel's size chunking, so a single line over the cap is split rather than rejected.
- One reply may become at most `MESSAGING_MAX_LINE_MESSAGES` (20) messages, a number taken from
  the tightest channel's per-chat burst allowance — Telegram answers 429 to roughly 20 messages a
  minute in one chat. The budget counts outbound messages rather than line bodies, the size
  chunking included, so a long answer cannot slip past it; past the budget the remaining lines
  ride one combined body rather than being dropped. The messages of such a reply go out a second
  apart, the pace that same allowance describes.
- Delivery is order-safe and failure-safe: the approval notice is queued behind whatever is
  already going out instead of landing between two lines of a reply, and a message the channel
  refuses costs only itself — it is recorded as an error while the rest of the reply still
  arrives.
- The group-chat rule is unchanged: the run's first outbound message threads onto the inbound one
  and everything after it is a plain send, so many lines do not become many quote headers. The
  option applies only to relayed assistant replies — never to the approval notice, the text-only
  notice or the test message.
- In the binding editor the option closes the form as a `Switch` for both channels, saved by the
  existing Save action, with its explanation behind the "?" beside its label.
