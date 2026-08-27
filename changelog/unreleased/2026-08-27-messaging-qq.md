# QQ joins Feishu and Telegram as a messaging channel

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `web`, `docs`

[中文版](2026-08-27-messaging-qq.zh.md)

A Session can now be bound to a QQ bot, the third channel behind the same connector seam as
Feishu and Telegram. Credentials are the App ID and App Secret from the QQ open platform;
inbound messages arrive over the platform's WebSocket gateway, so no public callback URL is
needed. The channel is not a copy of the other two, because QQ does not let a bot speak
freely: everything it sends is a reply to something the user just sent, and that shaped the
delivery rules below.

## Details

- `qq-api.ts` holds the transport — the app-access-token exchange with early refresh, the
  two message sends, and the gateway session (identify with the `GROUP_AND_C2C_EVENT`
  intent, heartbeat, resume, and the close codes that decide between resuming and
  identifying fresh). It is injectable, so no test opens a socket.
- `qq-connector.ts` holds the channel policy. Both `C2C_MESSAGE_CREATE` (single chat) and
  `GROUP_AT_MESSAGE_CREATE` (group @-mention) normalize to the bridge's inbound shape; the
  un-mentioned group firehose that rides the same intent is dropped.
- **The passive reply budget.** One inbound message funds at most 4 replies in a single chat
  and 5 in a group, inside a window of minutes. A run's first `budget - 1` completed
  assistant messages go out as they complete; everything after that is withheld and sent as
  one combined final message, so a long answer is coalesced rather than truncated. The
  approval notice shares that budget and takes the reserved slot when the immediate ones are
  gone — a run parked on an approval never reaches an end that a deferred notice could wait
  for.
- `linePerMessage` is clamped to the reply budget on QQ instead of the channel-neutral cap of
  20, through a new optional `replyBudget` on the connector seam. Feishu and Telegram declare
  none and are unchanged.
- **Nothing is pushed.** A send with no message to reply to — a turn started in the web app,
  or any reply after the window closed — is refused with a readable reason rather than
  attempted as an active message, which QQ rate-limits, gates behind separate approval, and
  lets any user switch off. The panel states this rule on screen rather than in a collapsed
  fold, since a user who does not know it reads the channel as broken.
- Outbound files are refused on this channel with a reason: the platform's rich-media path
  requires a publicly reachable URL for the bytes, which is the same constraint that ruled
  out the webhook mode. Inbound media is not read.
- Routes are the `/qq` subtree with the verb set the other channels carry (GET / PUT / state
  / DELETE / test / test-message). The App ID is the account identity, so the
  one-Session-per-account rule applies to a QQ bot exactly as it does to a Feishu app.
- The binding editor's channel selector is now three-way, with QQ's own form section, setup
  steps, reply-budget explanation and troubleshooting entry in both dictionaries.
