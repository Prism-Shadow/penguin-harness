# Telegram connections survive a poller conflict, and say what went wrong

- **Date:** 2026-08-27
- **Type:** fix
- **Scope:** `server`, `web`
- **PR:** [#484](https://github.com/Prism-Shadow/penguin-harness/pull/484)

[中文版](2026-08-27-telegram-conflict-recovery.zh.md)

A Telegram binding that hit Telegram's one-poller-per-token rule parked at "connection error" and never delivered another message. The poll loop now treats a `getUpdates` failure as the outage it is, clears a stale webhook when it connects, and the panel shows the whole failure message instead of its first few words.

## Details

- Recovery from a poll outage is gated on a `getUpdates` succeeding, not on the `getMe` probe in front of it. `getMe` never conflicts, so it used to clear the failure counter on every cycle: the exponential backoff never left its first step, the connector re-polled once a second indefinitely, an error record landed on every retry, and the connection status flapped between `connected` and `error` faster than the panel polls it. One outage now reports once and backs off up to the 60-second ceiling, as documented.
- A recovery poll runs with a zero-second timeout, so the end of an outage is observed immediately rather than after the next 30-second long-poll window.
- `deleteWebhook` runs once per connection, before the first poll. A webhook and `getUpdates` are mutually exclusive on the Bot API, so a bot that had been pointed at a webhook before it was bound could never be polled. Pending updates are kept; the connector's own backlog drain still decides what counts as the dark period.
- The Bot API's two actionable 409s are rewritten to lead with the action — "another program is already polling this bot …" and "a webhook is set on this bot, which blocks polling …" — instead of Telegram's wording, which buries it at the end of the sentence.
- The connection status line gives a failure its own row under the toggle, clamped to two lines with the full text on hover, rather than a truncated share of the row carrying the switch, the label and the status word. A Telegram binding's troubleshooting fold gained an entry naming the one-program-per-token rule.
- A poller conflict is one way the same inbound message reaches the bridge twice; the other end of that symptom is [inbound deduplication](2026-08-27-messaging-inbound-dedupe.md).
