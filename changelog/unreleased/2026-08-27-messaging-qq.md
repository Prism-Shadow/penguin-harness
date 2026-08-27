# QQ joins Feishu and Telegram as a messaging channel

- **Date:** 2026-08-27
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#501](https://github.com/Prism-Shadow/penguin-harness/pull/501)

[中文版](2026-08-27-messaging-qq.zh.md)

A Session gained a third channel to bind to: a QQ bot, behind the same connector seam Feishu
and Telegram already sat behind. The credentials are the App ID and App Secret from the QQ
open platform, and inbound messages ride the platform's WebSocket gateway, so binding one
asks for no public callback URL. The channel did not copy the other two, because QQ does not
let a bot speak freely: everything it sends is a reply to a message the user sent minutes
ago, and that shaped every delivery rule below.

## Details

- The transport landed in `qq-api.ts`: the app-access-token exchange with early refresh and
  one exchange per burst however many sends ask at once, the two message sends, and the
  gateway session — identify with the `GROUP_AND_C2C_EVENT` intent, heartbeat, resume, and
  the close codes that decide between resuming and identifying fresh. A session that stops
  carrying traffic without closing — no handshake, or heartbeats that stop being
  acknowledged — is dropped and retried on the backoff instead of sitting at `connected`
  with nothing arriving on it. It went in behind an injectable factory, so the tests reach
  it through fakes rather than the network.
- The channel policy landed in `qq-connector.ts`. `C2C_MESSAGE_CREATE` (single chat) and
  `GROUP_AT_MESSAGE_CREATE` (group @-mention) both normalize to the bridge's inbound shape;
  the un-mentioned group firehose that rides the same intent is dropped.
- **The passive reply budget.** One inbound message funds at most 4 replies in a single chat
  and 5 in a group, inside a window of minutes. A run's first `budget - 1` completed
  assistant messages go out as they complete; everything after that is withheld and sent as
  one combined final message, so a long answer is coalesced rather than truncated. The
  approval notice shares that budget and takes the reserved slot when the immediate ones are
  gone — a run parked on an approval never reaches an end that a deferred notice could wait
  for.
- That accounting is per chat, and it lives no longer than the connection that opened it:
  turning a binding off, or re-pointing it at other credentials, forgets it, so nothing
  withheld arrives in a chat the Session has stopped answering. A redelivered `msg_id` —
  which the platform repeats on purpose, to guarantee delivery — funds nothing new, and a
  reply the platform refuses keeps its text for the next inbound message's budget instead of
  losing it.
- `linePerMessage` was clamped to the reply budget on QQ rather than to the channel-neutral
  cap of 20, through a new optional `replyBudget` on the connector seam. Feishu and Telegram
  declare none and were left unchanged.
- **Nothing is pushed.** A send with no message to reply to — a turn started in the web app,
  or any reply after the window closed — is refused with a readable reason rather than
  attempted as an active message, which QQ rate-limits, gates behind separate approval, and
  lets any user switch off. The panel states that rule on screen rather than in a collapsed
  fold, since a user who does not know it reads the channel as broken.
- Outbound files are refused on this channel with a reason: the platform's rich-media path
  wants a publicly reachable URL for the bytes, the same constraint that ruled out the
  webhook mode. Inbound media is not read.
- The `/qq` route subtree arrived with the verb set the other channels carry (GET / PUT /
  state / DELETE / test / test-message). The App ID is the account identity, so the
  one-Session-per-account rule applies to a QQ bot exactly as it does to a Feishu app — on
  the enable, and on a save that would carry an already-enabled connection onto somebody
  else's bot.
- The binding editor's channel selector gained a third option, and QQ arrived with its own
  form section, setup steps, reply-budget explanation and troubleshooting entry in both
  dictionaries.
