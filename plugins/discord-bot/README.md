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

Open the System settings dialog (the user menu, admin only) and its **Plugins** page. The bot is listed there with the options this package declares, and nothing else configures it — no environment variable, no file to edit:

- **Bot token** — from the Bot page of the Discord developer portal. Stored on the server and shown masked afterwards; leave the field blank to keep it.
- **Project** — the Project every chat's Session is created under.
- **Agent** — the Agent in that Project that answers (default `default_agent`).
- **Enabled** — off keeps the token and stops the bot.

Save applies at once: the plugin watches its configuration and restarts the bot on the new values without a server restart. Values that do not make a bot — no token, a token that is not a Discord bot token, an Agent the Project does not have — are reported on the status route rather than guessed at.

Status, for an admin (the same page's values, read through the API, are `GET /api/admin/plugin-config`):

```sh
curl $BASE/api/discord-bot
# { "bot": { "projectId", "agentId", "botTokenMasked", "enabled", "status": { "state", "lastError"?, "lastInboundAt"?, "lastDeliveryError"? }, "chats" } | null,
#   "error": "why the values make no bot" | null, "configured": true | false }
```

The token never leaves the server in the clear. The chat → Session table is the bot's only other state; it lives in the server settings under `discord-bot:chats:<projectId>` and survives a restart.

## What the plugin is made of

The harness has no notion of a chat bot. This package composes what the harness already has — the Discord messaging connector (Gateway, sends, Markdown, the 2000-character cap), Session creation, the task runner, the Session event channel, the settings store and the options it holds for this package — into one: a Gateway connection on the token, a Session per chat, replies relayed back, the commands, the status route. Replace "Discord" with another channel the harness has a connector for and the same package shape gives you a bot there.

## Development

```sh
pnpm --filter @prismshadow/penguin-plugin-discord-bot build   # dist/, the file the Project config points at
pnpm --filter @prismshadow/penguin-plugin-discord-bot test    # the bot over fakes, and the integration test
```

The integration test starts a real server with this plugin through `@prismshadow/penguin-plugin-test`, saves the bot's options through the admin plugin-config API and reads the status route; it never connects to Discord. It needs the server and this package built first.
