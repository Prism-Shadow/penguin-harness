# Connect a Session to a messaging bot (Feishu, Telegram)

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#464](https://github.com/Prism-Shadow/penguin-harness/pull/464)

[中文版](2026-08-25-feishu-session-bridge.zh.md)

Added messaging-channel bindings with Feishu (Lark) and Telegram as the first two
channels: a Session can be connected to a self-built Feishu app or a Telegram bot, after
which messages sent to the bot flow into that Session as ordinary user input and the AI's
completed replies are relayed back to the chat. A Session keeps at most one saved config
per channel — both may sit saved side by side — and at most one of them is enabled, the
one holding the live connection.

## Details

- Two management surfaces shared one channel-aware binding editor: the session-row menu's
  "Messaging binding…" dialog, and a new "Messaging" dock panel in the conversation's
  panel rail (after the Trace panel) managing the current conversation's bindings. The
  channel selector switches freely between the two channels' forms, each independently
  savable and each showing its own configured / enabled state — Feishu takes App ID / App
  Secret / API domain, Telegram a single Bot Token. The form opens on the connection
  controls — the enable switch with its live status, the two probes, then the hint naming
  what gates the switch — and the credential fields follow them, so the controls hold one
  vertical offset in both channels even though their field lists differ in length. The
  channel's developer-console link rides the credential field's top-right corner (the
  models page's "get API key" idiom), and collapsed folds below the Save area hold the
  setup steps (ending in the channel's tutorial link), what binding does, and
  troubleshooting.
- A stored secret is managed the way the models page manages an API key: the field always
  starts empty, the saved value shows only as its site-wide mask on the line beneath, and
  a "clear stored …" checkbox next to that mask drops it on save (typing a replacement
  wins over a checked box). Clearing is refused while the channel's connection is enabled
  — the checkbox is disabled with the reason on screen, and the server answers 409
  `messaging_disable_before_clear` — so a live connection can never outrun the credential
  its store still has. There is no unbind button: removing a credential is the clear.
- Saving and enabling were made separate concerns: Save persisted credentials only and
  never touched the connection (with one exception — an enabled binding's connector
  restarted with the just-saved credentials, so stored config and live connection never
  diverge), while a dedicated enable switch connected or terminated using the stored
  credentials. Enabling is mutually exclusive per Session: the switch is grayed with a
  "turn the other channel's connection off first" hint, and the server refuses it with
  409 `another_channel_enabled`. New configs started disabled; server startup connected
  only the enabled ones, and the session row carries a small paper plane — one mark for
  every channel, the channel itself named in the mark's tooltip and screen-reader text —
  for an enabled connection rather than a merely saved one.
- The sidebar row's hover affordance changed shape: archive stayed a direct button, and
  the delete button was replaced by a solid three-dot "more" button that opens the row's
  full context menu anchored at itself — the menu gained configuration actions that
  right-click alone left undiscoverable, and delete moved inside it (still
  danger-styled).
- The server stored configs in a channel-discriminated `messaging_bindings` table keyed
  by `(session_id, channel)`, with cross-session uniqueness per bot account per channel
  (409 `feishu_app_in_use` / `telegram_bot_in_use`) and `enabled` as stored intent, and
  ran a messaging bridge holding the enabled binding's inbound event connection behind a
  channel-connector seam: Feishu over the SDK's WebSocket long connection, Telegram over
  an offset-based `getUpdates` long poll (connect drains the dark-period backlog;
  transient poll failures back off, report once per outage, and recover) — neither needs
  a public URL. Inbound text started Tasks with `queueIfBusy` as plain composer-style
  input (no marker, no special sender — the model does not learn the message came from a
  messaging channel); other message types got a bilingual "text only" reply; every
  completed task mirrored its assistant text back to the last known chat (reply-to-message
  in group chats), chunked under the channels' text-size limits (inside Telegram's
  4096-character cap), and a pending tool-call approval sent a one-line notice pointing at
  the web UI.
- New endpoints under `/api/sessions/:sessionId/messaging`: a channel-agnostic GET
  listing every saved channel config (`channel`-discriminated, per-row `enabled` and
  runtime status) plus the same verb set per channel — `/feishu` and `/telegram` each
  with get / put / state / delete / test / test-message. PUT carries the channel's clear
  flag; the state toggle answers 400 `feishu_secret_required` /
  `telegram_token_required` for a config whose secret was cleared. DELETE removes a whole
  channel config and is kept for API completeness — the web UI's removal affordance is
  the clear flag. Telegram's bot identity is the numeric id in front of the token's
  colon, so a rotated token keeps its binding, and a cleared config keeps that identity.
  Secrets masked in every response and kept on a blank re-save, reads and tests for any
  Project member, writes owner-only. Deleting the Session removed all its configs.
