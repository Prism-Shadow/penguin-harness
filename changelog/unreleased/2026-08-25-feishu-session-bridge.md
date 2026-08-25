# Bind a Session to a Feishu bot

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `core`, `server`, `web`, `docs`
- **PR:** [#464](https://github.com/Prism-Shadow/penguin-harness/pull/464)

[中文版](2026-08-25-feishu-session-bridge.zh.md)

Added a Session ↔ Feishu (Lark) bot binding: a Session picked in the web sidebar can be
connected to a self-built Feishu app, after which messages sent to the bot flow into that
Session as input and the AI's completed replies are relayed back to the Feishu chat.

## Details

- New session-row action "Bind to Feishu…" opened a dialog with App ID / App Secret / API
  domain and an enable switch, plus a credential test, a "send test message" probe, and an
  unbind behind a confirmation; bound rows gained a small paper-plane indicator.
- The server held one Feishu long-connection event stream per enabled binding (no public
  callback URL needed), started next to the scheduler and stopped with the App. Inbound
  text messages started a Task on the bound Session as a `[feishu_message]`-prefixed
  server input — busy Sessions queued it as a follow-up — while other message types got a
  bilingual "text only" reply. Every completed task mirrored its assistant text back to
  the last known chat (reply-to-message in group chats), chunked under Feishu's text-size
  limits, and a pending tool-call approval sent a one-line notice pointing at the web UI.
- New endpoints under `/api/sessions/:sessionId/feishu` (get / put / delete / test /
  test-message): one binding per Session and per Feishu app (409 `feishu_app_in_use`),
  the secret masked in every response and kept on a blank re-save, reads for any Project
  member and writes owner-only. Deleting the Session removed its binding.
- Core gained the `[feishu_message]` origin block (builder + parser next to
  `[scheduled_task]`), which the chat page collapses into a one-line "Message from
  Feishu" banner.
