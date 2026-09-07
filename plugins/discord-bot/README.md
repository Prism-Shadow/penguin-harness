# Discord bot

A Discord bot that **starts agents from chat**: message the bot, and a Session opens on the Agent you configured and answers in the same channel. Nobody has to open the Web App first.

## What you get

- **A Session per chat.** A direct message to the bot, a channel where it is @-mentioned, or a thread — each gets its own Session, opened on the first message and reused for the rest. The Sessions appear in the Web App under the configured Agent like any other.
- **Replies where the question was asked.** Every completed assistant message comes back into the same channel, Markdown rendered, chunked under Discord's 2000-character limit, threaded onto your message in a server channel. Pictures and files you attach reach the Agent; a voice message does not.
- **A few commands.** `/new` starts a fresh Session in that chat. `/approve` allows a tool call the Agent is waiting on (`/deny` refuses it) — the bot tells you when one is waiting. `/status` names the chat's Session.

In a server channel the bot reads only messages that @-mention it; direct messages reach it as they are. That needs no privileged intent in the Discord developer portal, so nothing has to be switched on there.

## Requirements

- A Discord application with a bot user, from the [developer portal](https://discord.com/developers/applications): reset the token on its Bot page and keep it. Invite the bot to your server through OAuth2 → URL Generator with the `bot` scope and the Send Messages, Read Message History and Attach Files permissions.
- A Project and an Agent in PenguinHarness for the bot's Sessions to run under, with a default model configured.

## Install

The plugin ships with every PenguinHarness build but is not installed by default. On a Project's Plugins page, add it to that Project's plugins (it is tagged _built in_ there — nothing is downloaded); it is loaded without a restart. Or list it by hand in that Project's `.project_config.toml`:

```toml
plugins = ["@prismshadow/penguin-plugin-discord-bot"]
```

## Configure

Either way below; what is saved through the API wins over the environment, and a bot switched off there stays off.

**Through the environment** of the server process — the bot starts enabled when all three are set:

```sh
PENGUIN_DISCORD_BOT_TOKEN=MTIz….GaBcDe.…
PENGUIN_DISCORD_PROJECT=birder-default_project
PENGUIN_DISCORD_AGENT=default_agent
```

**Through the settings API** (admin), which the Web App's chat-bot settings also use:

```sh
# save the credential and the target
curl -X PUT $BASE/api/chat-bots/discord -H 'content-type: application/json' \
  -d '{"config":{"botToken":"MTIz….GaBcDe.…"},"projectId":"birder-default_project","agentId":"default_agent"}'
# probe the token (answers the bot's @username)
curl -X POST $BASE/api/chat-bots/discord/test -H 'content-type: application/json' -d '{}'
# connect
curl -X POST $BASE/api/chat-bots/discord/state -H 'content-type: application/json' -d '{"enabled":true}'
# status
curl $BASE/api/chat-bots/discord
```

`GET /api/chat-bots` lists every bot a plugin contributed, masked credential and live status included.

## Development

```sh
pnpm --filter @prismshadow/penguin-plugin-discord-bot build   # dist/, the file the Project config points at
pnpm --filter @prismshadow/penguin-plugin-discord-bot test    # the seed, and the integration test
```

The integration test starts a real server with this plugin through `@prismshadow/penguin-plugin-test` and drives the settings API; it never connects to Discord. It needs the server and this package built first.
