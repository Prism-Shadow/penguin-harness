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

**Through the plugin's own API** (admin), `/api/discord-bot`:

```sh
# save the token and the target
curl -X PUT $BASE/api/discord-bot -H 'content-type: application/json' \
  -d '{"botToken":"MTIz….GaBcDe.…","projectId":"birder-default_project","agentId":"default_agent"}'
# probe the token (answers the bot's @username)
curl -X POST $BASE/api/discord-bot/test -H 'content-type: application/json' -d '{}'
# connect
curl -X POST $BASE/api/discord-bot/state -H 'content-type: application/json' -d '{"enabled":true}'
# status: the masked token, the target, the live connection and how many chats hold a Session
curl $BASE/api/discord-bot
```

The token never comes back in the clear; a PUT with the masked value keeps the stored one, and `clearBotToken: true` drops it (once the bot is disabled). Everything is stored in the server settings under `discord-bot:` keys and survives a restart.

## What the plugin is made of

The harness has no notion of a chat bot. This package composes what the harness already has — the Discord messaging connector (Gateway, sends, Markdown, the 2000-character cap), Session creation, the task runner, the Session event channel and the settings store — into one: a Gateway connection on the token, a Session per chat, replies relayed back, the commands, the settings routes. Replace "Discord" with another channel the harness has a connector for and the same package shape gives you a bot there.

## Development

```sh
pnpm --filter @prismshadow/penguin-plugin-discord-bot build   # dist/, the file the Project config points at
pnpm --filter @prismshadow/penguin-plugin-discord-bot test    # the seed, and the integration test
```

The integration test starts a real server with this plugin through `@prismshadow/penguin-plugin-test` and drives the settings API; it never connects to Discord. It needs the server and this package built first.
