# Bind a Session to a messaging bot (Feishu, Telegram)

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#464](https://github.com/Prism-Shadow/penguin-harness/pull/464)

[中文版](2026-08-25-feishu-session-bridge.zh.md)

Added messaging-channel bindings with Feishu (Lark) and Telegram as the first two
channels: a Session can be connected to a self-built Feishu app or a Telegram bot, after
which messages sent to the bot flow into that Session as ordinary user input and the AI's
completed replies are relayed back to the chat.

## Details

- Two management surfaces shared one channel-aware binding editor: the session-row menu's
  "Messaging binding…" dialog, and a new "Messaging" dock panel in the conversation's
  panel rail (after the Trace panel) managing the current conversation's binding. A
  channel selector (Feishu / Telegram) chose the form while unbound and locked once bound
  (switching means unbinding first); fields swapped per channel — App ID / App Secret /
  API domain for Feishu, a single Bot Token for Telegram — under a per-channel links row
  ("Open tutorial" and "Open developer console"). The editor carried a credential test
  (Telegram's success feedback names the bot's @username), a "send test message" probe
  (needs a connected binding and a known chat), and an unbind behind a confirmation; a
  saved secret showed only as its site-wide masked placeholder (type to replace, blank
  keeps it), and bound rows gained a small per-channel indicator glyph.
- Saving and enabling were made separate concerns: Save persisted credentials only and
  never touched the connection (with one exception — an enabled binding's connector
  restarted with the just-saved credentials, so stored config and live connection never
  diverge), while a dedicated enable switch connected or terminated using the stored
  credentials (gated with a "save credentials first" hint while the form had unsaved
  edits). New bindings started disabled; server startup connected only enabled bindings.
- The sidebar row's hover affordance changed shape: archive stayed a direct button, and
  the delete button was replaced by a solid three-dot "more" button that opens the row's
  full context menu anchored at itself — the menu gained configuration actions that
  right-click alone left undiscoverable, and delete moved inside it (still
  danger-styled).
- The server stored bindings in a channel-discriminated `messaging_bindings` table (one
  binding per Session, one per bot account per channel — 409 `feishu_app_in_use` /
  `telegram_bot_in_use`; `enabled` as stored intent) and ran a messaging bridge holding
  one inbound event connection per enabled binding behind a channel-connector seam:
  Feishu over the SDK's WebSocket long connection, Telegram over an offset-based
  `getUpdates` long poll (connect drains the dark-period backlog; transient poll failures
  back off, report once per outage, and recover) — neither needs a public URL. Inbound
  text started Tasks with `queueIfBusy` as plain composer-style input (no marker, no
  special sender — the model does not learn the message came from a messaging channel);
  other message types got a bilingual "text only" reply; every completed task mirrored
  its assistant text back to the last known chat (reply-to-message in group chats),
  chunked under the channels' text-size limits (inside Telegram's 4096-character cap),
  and a pending tool-call approval sent a one-line notice pointing at the web UI.
- New endpoints under `/api/sessions/:sessionId/messaging`: a channel-agnostic GET
  (whichever channel is bound, `channel`-discriminated) plus the same verb set per
  channel — `/feishu` and `/telegram` each with get / put / state / delete / test /
  test-message. Telegram's bot identity is the numeric id in front of the token's colon,
  so a rotated token keeps its binding. Secrets masked in every response and kept on a
  blank re-save, reads and tests for any Project member, writes owner-only. Deleting the
  Session removed its binding.
