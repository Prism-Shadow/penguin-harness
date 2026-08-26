# Bind a Session to a Feishu bot

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#464](https://github.com/Prism-Shadow/penguin-harness/pull/464)

[中文版](2026-08-25-feishu-session-bridge.zh.md)

Added messaging-channel bindings with Feishu (Lark) as the first channel: a Session can
be connected to a self-built Feishu app, after which messages sent to the bot flow into
that Session as ordinary user input and the AI's completed replies are relayed back to
the Feishu chat.

## Details

- Two management surfaces shared one binding editor: the session-row menu's "Bind to
  Feishu…" dialog, and a new "Messaging" dock panel in the conversation's panel rail
  (after the Trace panel) managing the current conversation's binding. The editor carried
  the App ID / App Secret / API-domain form, a tutorial link, a credential test, a "send
  test message" probe (needs a connected binding and a known chat), and an unbind behind
  a confirmation; a saved secret showed only as its site-wide masked placeholder (type to
  replace, blank keeps it), and bound rows gained a small paper-plane indicator.
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
  binding per Session, one per bot account per channel — 409 `feishu_app_in_use`;
  `enabled` as stored intent) and ran a messaging bridge holding one long-connection
  event stream per enabled binding behind a channel-connector seam, with the Feishu
  connector as its first implementation. Inbound text started Tasks with `queueIfBusy`
  as plain composer-style input (no marker, no special sender — the model does not learn
  the message came from Feishu); other message types got a bilingual "text only" reply;
  every completed task mirrored its assistant text back to the last known chat
  (reply-to-message in group chats), chunked under Feishu's text-size limits, and a
  pending tool-call approval sent a one-line notice pointing at the web UI.
- New endpoints under `/api/sessions/:sessionId/messaging/feishu` (get / put / state /
  delete / test / test-message): the secret masked in every response and kept on a blank
  re-save, reads and tests for any Project member, writes owner-only. Deleting the
  Session removed its binding.
