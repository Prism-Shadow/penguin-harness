# A Discord bot that starts agents from chat, as a plugin

- **Date:** 2026-09-07
- **Type:** feature
- **Scope:** `plugins`, `server`
- **PR:** [#641](https://github.com/Prism-Shadow/penguin-harness/pull/641)

[中文版](2026-09-07-discord-bot-plugin.zh.md)

A messaging binding ties one bot to one Session somebody already opened in the Web App. The
new plugin `@prismshadow/penguin-plugin-discord-bot` inverts that: the bot is configured once,
with a token and a target Agent, and every chat that writes to it — a direct message, a
channel it is @-mentioned in, a thread — gets a Session of its own, opened on the first
message and reused for the rest. Nobody opens the Web App first; the Sessions still appear
there, under the target Agent.

## Details

- **The harness gained no chat-bot concept.** The plugin composes what the harness already
  has: the Discord messaging connector (Gateway, sends, Markdown, the 2000-character cap),
  Session creation, the task runner, the Session event channel and the settings store — all
  reached through the module's `requires`. What changed on the server is that
  `Messaging.connectorFor` is public and the type-only plugin surface exports the mechanisms
  a plugin of this kind needs (`MessagingTaskRunner`, `ScheduleSessionCreator`, `SessionIndex`,
  `AgentIndex`, `Settings`, `Channels`, `Errors`, `Paths`, `Log`, `Clock`, the connector's types
  and `ChannelEvent`).
- **One Gateway connection, a Session per chat.** Messages are routed by chat id; a chat with
  no Session gets one through the path a scheduled task uses. Replies come back into the same
  chat as they complete, Markdown rendered, cut under Discord's cap, threaded onto the inbound
  message in a server channel. Pictures reach the Agent as inline images and files land in the
  Session scratchpad, named on the message.
- **Commands.** `/new` opens a fresh Session for that chat; `/approve` and `/deny` decide the
  tool call the Agent is waiting on (the bot says when one is), since the person asking has no
  Web App in front of them; `/status` names the chat's Session.
- **Configuration.** The plugin's own admin API at `/api/discord-bot` (`GET`, `PUT
  {botToken?, clearBotToken?, projectId?, agentId?}`, `POST /state`, `POST /test`), contributed
  through the `HttpModule.routes` slot with a bundled Hono; or a seed from the server's
  environment (`PENGUIN_DISCORD_BOT_TOKEN`, `PENGUIN_DISCORD_PROJECT`, `PENGUIN_DISCORD_AGENT`
  — all three set, the bot starts enabled). Stored values win over the seed, and a bot switched
  off stays off. State lives under `discord-bot:` keys in the server settings and survives a
  restart and a hot swap.
- The plugin ships with every build, listed in the builtin registry and not installed by
  default.
