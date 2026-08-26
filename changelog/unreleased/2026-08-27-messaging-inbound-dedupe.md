# A redelivered chat message starts one Task, not two

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `server`
- **PR:** [#484](https://github.com/Prism-Shadow/penguin-harness/pull/484)

[中文版](2026-08-27-messaging-inbound-dedupe.zh.md)

A message a channel handed the bridge twice queued two Tasks and ran both, appearing twice in the chat and twice in the Web App. The bridge now drops a message its binding has already processed.

## Details

- Deduplication is per binding and keyed on the channel's own message identity — Feishu's `message_id`, Telegram's `chatId:message_id`. Never on the text: the same question asked twice is two messages and still runs twice.
- A duplicate is a complete no-op, ahead of the chat record and the text-only reply as well as the Task start, so a replayed sticker no longer answers with the notice twice.
- The memory is bounded on both axes — the last 64 message ids per binding, within a ten-minute window — and belongs to the binding rather than to one connection, so re-saving an enabled binding (which restarts its connector) does not replay what it already processed. It is dropped when the binding or its Session is removed.
- The memory is in-process: a server restart forgets, so a redelivery that survives a restart still duplicates.
- Both surfaces showed one duplicate because a queued follow-up's input is published to the Session channel. The same user-visible symptom is addressed from the other end by [the Telegram poller-conflict fix](2026-08-27-telegram-conflict-recovery.md), which removes a common source of redelivery.
