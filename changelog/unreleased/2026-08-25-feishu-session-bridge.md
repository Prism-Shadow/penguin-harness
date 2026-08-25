# Bind a Session to a Feishu bot

- **Date:** 2026-08-25
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#464](https://github.com/Prism-Shadow/penguin-harness/pull/464)

[中文版](2026-08-25-feishu-session-bridge.zh.md)

Added messaging-channel bindings with Feishu (Lark) as the first channel: a Session picked
in the web sidebar can be connected to a self-built Feishu app, after which messages sent
to the bot flow into that Session as ordinary user input and the AI's completed replies
are relayed back to the Feishu chat.

## Details

- New session-row action "Bind to Feishu…" opened a dialog with App ID / App Secret / API
  domain, a tutorial link, a credential test, a "send test message" probe, and an unbind
  behind a confirmation. A stored binding is always active — the primary button reads
  "Save & connect", and unbind is how a connection stops. A saved secret shows only as its
  site-wide masked placeholder (type to replace, blank keeps it), and bound rows gained a
  small paper-plane indicator.
- The sidebar row's hover affordance changed shape: archive stayed a direct button, and
  the delete button was replaced by an ellipsis "more" button that opens the row's full
  context menu anchored at itself — the menu gained configuration actions that right-click
  alone left undiscoverable, and delete moved inside it (still danger-styled).
- A new left-nav page "Messaging" (`/messaging`, between Cost Center and Evaluation
  Center) listed the Project's bindings — session (clickable), agent, channel, live
  runtime status — with edit reusing the same binding dialog and unbind confirmed; its
  empty state points at the session-row menu entry.
- The server stored bindings in a channel-discriminated `messaging_bindings` table (one
  binding per Session, one per bot account per channel — 409 `feishu_app_in_use`) and ran
  a messaging bridge holding one long-connection event stream per binding behind a
  channel-connector seam, with the Feishu connector as its first implementation. Inbound
  text started Tasks with `queueIfBusy` (busy Sessions queue, never 409); other message
  types got a bilingual "text only" reply; every completed task mirrored its assistant
  text back to the last known chat (reply-to-message in group chats), chunked under
  Feishu's text-size limits, and a pending tool-call approval sent a one-line notice
  pointing at the web UI.
- New endpoints under `/api/sessions/:sessionId/messaging/feishu` (get / put / delete /
  test / test-message) plus `GET /api/projects/:projectId/messaging` for the page's
  secret-free listing: the secret masked in every response and kept on a blank re-save,
  reads for any Project member and writes owner-only. Deleting the Session removed its
  binding.
