# Enabling a messaging connection is the binding

- **Date:** 2026-08-26
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#490](https://github.com/Prism-Shadow/penguin-harness/pull/490)

[中文版](2026-08-26-messaging-bind-by-enable.zh.md)

A Feishu app or a Telegram bot used to belong to one Session forever: whichever Session saved its
credentials first owned it, a second Session's save was refused with 409 `feishu_app_in_use` /
`telegram_bot_in_use`, and the Web App offered no unbind, so moving a bot to another conversation
had no path through the product at all. Saving stopped being exclusive: enabling the connection is
what binds the account to a conversation, and turning that switch off releases it.

## Details

- Saving credentials no longer conflicts across Sessions. Any number of Sessions may keep the same
  Feishu app or Telegram bot saved side by side, each with its own stored config and its own
  remembered chat. Both PUTs lost their 409 and `MessagingBindingsRepo.upsert` lost its failure
  mode.
- Enabling a channel is refused while **another Session has a binding on the same
  `(channel, account_id)` enabled**: 409 `account_enabled_elsewhere` — turn that one off first.
  One account has one event stream, so that is the only exclusivity that remains.
- That refusal says nothing about the Session holding the connection. Authorization is per
  Project and the route proved access to the caller's Session only, so the holder may sit in a
  Project the caller cannot see; the remedy does not depend on hearing it named.
- The per-Session rule is unchanged: at most one of a Session's own channels is enabled at a time
  (409 `another_channel_enabled`).
- In the binding editor, the connection switch carries the new meaning as its own tooltip, and the
  "what binding does" fold states how one bot moves between conversations without a credential
  being deleted. The two retired error codes left both string dictionaries and
  `account_enabled_elsewhere` joined them.
- The unique index `idx_messaging_account` was replaced by a plain `idx_messaging_by_account` over
  the same columns, and is dropped from databases that already carry it — see
  [backward compatibility](2026-08-26-backward-compatibility.md).
