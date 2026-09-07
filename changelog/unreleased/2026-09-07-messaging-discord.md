# Discord joins as a fifth messaging channel

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `server`, `web`, `docs`
- **PR:** [#641](https://github.com/Prism-Shadow/penguin-harness/pull/641)

[中文版](2026-09-07-messaging-discord.zh.md)

A Session gained a fifth channel to bind to: a Discord bot, behind the same connector seam
the other four already sit behind. Binding it is one bot token pasted from the developer
portal, whose first segment names the bot, so the account identity falls out of the credential
the way it does on Telegram. Inbound messages arrive over the platform's Gateway WebSocket, so
binding one asks for no public callback URL, and the channel carries text, pictures and files
in both directions.

## Details

- The transport landed in `discord-api.ts`: the REST calls (`GET /users/@me` as the credential
  probe, the channel message send with mentions suppressed, the multipart upload, the capped
  attachment download) and the Gateway session — identify, heartbeat with an ack watchdog,
  resume on the URL READY hands back, re-identify after the two close codes that end a
  session, stop for good on a rejected token or refused intents. It went in behind an
  injectable factory, so the tests reach it through fakes rather than the network. No SDK is
  taken: the Gateway is the opcode numbering the QQ connector already speaks.
- **The bot reads direct messages and @-mentions, and asks for no privileged intent.**
  Discord blanks a server message's content for any bot without the message-content intent,
  except direct messages and messages that @-mention the bot — so the connector subscribes
  the two unprivileged message intents, reads exactly those two kinds, and strips the
  addressing mention off the front as the Telegram connector does. A bot works without any
  portal setting to get wrong; a message written in a server channel without the mention is
  not delivered, and the binding editor says so on screen rather than in a fold.
- A thread is a channel of its own on this platform, so the channel id alone routes a reply
  back to where the question was asked; the reply ref packs the channel and the message id.
  Bots' messages — this bot's own included — and system messages are dropped.
- **The connector seam gained an optional `textChunkChars`.** Discord caps a message at 2000
  characters, under the shared chunk size the bridge cuts replies at, and a channel with a
  tighter cap now declares it rather than lowering the size for everyone. The Discord connector
  chunks at 1900 to leave room for the escapes its renderer adds, and a rendered reply that
  still outgrows the cap is sent as plain text in cap-sized pieces — formatting lost, message
  kept.
- `discord-markdown.ts` renders a reply into the subset Discord's client reads. Like WeChat's,
  it subtracts rather than translates: headings up to the third level, bold, italic,
  strikethrough, lists, quotes, links and code render as written; a deeper heading becomes a
  bold line, a table a code block, a rule a short dash line, a task box a glyph.
- Inbound attachments arrive as the composer's two attachment shapes — a picture as an
  `image_url` part, anything else as a file in the Session scratchpad — except a voice
  message's recording, which keeps the not-supported notice. Outbound, a picture and a file
  are the same upload, since Discord shows an image attachment inline.
- The `/discord` route subtree arrived with the verb set the other channels carry, the PUT
  and the credential test hand-written on the Telegram shape: one token, its bot id decoded on
  save (400 `discord_token_invalid` otherwise), the probe naming the bot's handle. The binding
  editor gained the channel, its token field with the developer-portal link, the on-screen
  mention rule, and two troubleshooting entries; the server API docs gained its rows.
