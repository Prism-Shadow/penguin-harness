# PRFC-0012 A bot that starts agents from chat is a plugin's job

[中文版](PRFC-0012-chat-bots.zh.md)

> **Source**: `rfcs/PRFC-0012-chat-bots.md` from the design repository [penguin-harness-design](https://github.com/Prism-Shadow/penguin-harness-design) — a draft, see design PR [#127](https://github.com/Prism-Shadow/penguin-harness-design/pull/127) (draft).
> **Rev**: v1.0.0 (migrated into the main repository, taking the draft's current version); the conventions for this surface are in [README.md](README.md), and changes from version to version are recorded in `## Changes` at the end.

- Feature Name: `discord_bot_plugin`
- Start Date: 2026-09-07
- PRFC PR: [Prism-Shadow/penguin-harness-design#127](https://github.com/Prism-Shadow/penguin-harness-design/pull/127)
- Implementation PR: [Prism-Shadow/penguin-harness#641](https://github.com/Prism-Shadow/penguin-harness/pull/641)

## Summary
[summary]: #summary

"Message on Discord and an agent answers" is delivered entirely by the plugin `@prismshadow/penguin-plugin-discord-bot`; the platform **does not add** any "chatbot" concept. The plugin's manifest `requires` the platform's existing mechanisms — the messaging bridge's connectors, Session creation, task launching, the Session event channel, settings storage, plugin config — and assembles them itself into a bot: one Gateway connection, one Session per chat, replies delivered back to where they came from, a few commands, and one read-only status route; the configuration is filled in on the "Plugins" page of system settings. For this the platform does three small things: make the bridge's `connectorFor` public, export these existing mechanisms on the type-only plugin surface, and give every plugin a generic **plugin config** mechanism — packages declare their options in the manifest, admins fill them in on the "Plugins" page, and modules read and watch them through `PluginConfig`.

## Motivation
[motivation]: #motivation

The requirement is "I can start an agent on Discord and interact with it." Session binding (05 "Messaging") cannot do this: it requires first opening a conversation in the web UI and binding the bot to it, and one bot account serves only one conversation at a time. The person asking from inside a chat app has no web UI in front of them; they want to send a message and have an agent answer, with a different channel being a different conversation.

The first version built this logic into the platform as a `ChatBotsModule` (a channel-agnostic host plus a slot for the plugin), leaving the plugin with nothing but a manifest entry. That was rejected: **do not add abstractions to the core for one plugin's needs**. The platform should provide mechanisms, not a product form such as "bot"; when a Telegram or Lark bot plugin actually appears, we can then look at whether there is a common part worth extracting — what gets extracted at that point is the genuinely common part.

## Guide-level explanation
[guide-level-explanation]: #guide-level-explanation

**For operators.** Install `discord-bot` from the Project's plugins page (bundled with the build, not installed by default, no restart needed). In the Discord developer portal, create an application, add a bot, copy the token, and use the OAuth2 link to invite it into your server. Then open the "Plugins" page of system settings (user menu, admins only): the bot is listed there — fill in four items: Bot Token, Project, Agent (default `default_agent`), and Enabled. Saving takes effect immediately, with no restart; reading `GET /api/discord-bot` (admins only) shows its status. Configuration lives on that one page — there are no environment variables and no files to edit by hand.

**For users.** DM the bot, or @ it in a channel, and you are talking with an agent. Replies come back to the same channel (in a channel, quoting your message); images and files you attach make it through. `/new` starts over; when the agent wants to execute a tool call that needs approval, the bot says so — reply `/approve` to allow, `/deny` to refuse; `/status` reports the Session behind this conversation. These Sessions also appear under the target agent in the web UI.

**For plugin authors.** This package is a sample of "what a code plugin can do": the manifest `requires` platform mechanisms and `contributes` a route, and the code wires them together; configuration is declared in the manifest and stored and displayed by the platform, rather than the plugin rolling its own storage or settings page. Swap in another channel for which the platform has a connector, and the same package shape is that channel's bot.

## Reference-level explanation
[reference-level-explanation]: #reference-level-explanation

### Platform-side changes (only these three)

- The `Messaging` mechanism gains one public method, `connectorFor(channel)`: it already existed in the bridge, just private.
- `@prismshadow/penguin-server/plugin` (types only) gains new exports: the connector-seam types (`MessagingChannelConnector` / `MessagingClient` / `MessagingConnection` / `MessagingConnectorHandlers` / `MessagingInboundMessage` / `MessagingInboundImage` / `MessagingInboundFile` / `MessagingSendOptions` / `MessagingChannel`), `MessagingTaskRunner`, `ScheduleSessionCreator`, `SessionIndex`, `AgentIndex`, `Projects`, `ProjectConfigStore`, `Settings`, `Channels`, `ChannelEvent`, `Errors`, `Paths`, `Log`, `Clock`. All are existing mechanisms; exporting them only lets plugins `requires` them in their manifests.
- **Plugin config** (generic, not just for this plugin): `package.json#penguin.configuration` declares the options — a title and description (with `…Zh` Chinese halves) plus `properties`, each field one of `string` / `secret` / `boolean` / `number` / `project`, each carrying a title, a description, a default, placeholder text, and `required`; the loader reads it without running the package, and a schema it cannot render fails that plugin's load and names the file. Values live server-wide in `server_settings` under `plugin-config:<package name>`, one JSON document per package; secrets are stored in the database in plaintext and masked on every API surface — sending the mask back verbatim keeps the value, sending empty clears it, and `required` fields can never be left empty. A new `PluginConfigModule` is added under the platform root (kept apart from the settings group — a plugin that replaces the settings group replaces the storage, not this layer), exporting the mechanism `PluginConfig` — `get(name)` answers with the stored values merged over the defaults, `watch(name, cb)` fires after every save — and `PluginConfigAdmin` (`describe` / `set`, for the routes). Admin routes `GET/PUT /api/admin/plugin-config`; the system-settings dialog gains a "Plugins" sub-page (in the server group, admins only, placed after "Sandbox") that renders its form from the schema and saves each plugin separately.

### The plugin

- The package `plugins/discord-bot`, with one module, `DiscordBot`. The manifest `requires`: `Messaging` (from `MessagingHubModule` — `from` must be a module visible under the platform root), `MessagingTaskRunner` / `Sessions` / `ScheduleSessionCreator` / `SessionIndex` (`SessionRuntimeModule`), `AgentIndex` (`ProjectsModule`), `Settings` (`SettingsModule`), `PluginConfig` (`PluginConfigModule`), `Channels` / `Paths` / `Log` (`RuntimeModule`), `Errors` (`ObservabilityModule`); it `contributes` `HttpModule.routes`: `{ id: "discord-bot.routes", prefix: "/api/discord-bot", auth: "user" }`. At runtime it `import`s the platform SDK (`@prismshadow/penguin-core`, marked external at build time so the host's copy is used) to get `userText` / `imageUrlMessage` / `attachedFileLine` / `scratchpadDir` / `modelVisiblePath`; it ships its own copy of Hono to produce its routes (the host's `route()` mounts a sub-app's `routes` one by one, which works across copies; errors are rendered as JSON by the sub-app's own `onError`).
- Config: the manifest declares `bot_token` (secret, required, must decode into a bot id), `project` (project, required), `agent` (string, default `default_agent`, must exist in that Project), `enabled` (boolean, default true). The manager (manager.ts) reads this package's values through `PluginConfig.get` and `watch`es every save: when the values make a bot, one is created (the same values mean no restart; changed values mean a restart under the new ones); when they don't, none is created and the reason is recorded in `error`; when the values are cleared, it stops. One deployment, one bot. The token sits in plaintext in server-side settings — the same trade-off as the proxy address and the message-binding credentials; the status route returns only the mask.
- The chat table: one `server_settings` key, `discord-bot:chats:<projectId>` → `{ [chatId]: { sessionId, isDirect, lastMessageId } }`; entries whose Session has been deleted are dropped on read.
- Runtime (this one bot): one inbound connection (`connector.connect`) and one outbound client (`connector.createClient`), with a generation counter invalidating the callbacks of superseded connections. Inbound routes by `chatId`: a chat without a Session gets one via `ScheduleSessionCreator.createSession({ projectId, agentId })`, is recorded in the table, and subscribes to its channel; input synthesis — text passes through verbatim, images are fetched up to the 20MB cap into `image_url` parts, files are written under `scratchpadDir(root, projectId, agentId)/<sessionId>/` (sanitized names, exclusive creation, per-file and total caps set by the admin) and appended after the text with `attachedFileLine` — launches a Task with `queueIfBusy`; if any one piece cannot be fetched, the whole message stops and a bilingual notice goes back. Commands are recognized at the head of the text (`/` or `!`): `new`, `approve` / `deny` (picks the chat's earliest pending-approval `toolCallId` and hands it to `Sessions.decideApproval`), `status`. Deduplication: memory holds the most recent 64 message ids, the chat table holds each chat's last fully processed message id, and the table is folded back into memory when a connection is established. Outbound: forwards only the main session's completed assistant text, skipping compaction windows; after a three-tier split — paragraphs, then lines, then a hard cut — at 1900 characters, the connector renders Markdown and sends (whatever is still over the limit after rendering falls back to plain text inside the connector); in group chats, the first message of a run quotes the incoming message; sends within the same chat are serialized; an `approval_request` gets its own notice naming `/approve` / `/deny`, and the `toolCallId` is recorded. Failures land in error_records (source `messaging`; a connector-reported recoverable shutdown is recorded as expected).
- Connection state `{ state, lastError?, changedAt?, lastInboundAt?, lastDeliveryError? }` lives only in memory and is returned by `GET /api/discord-bot` as `{ bot: { projectId, agentId, botTokenMasked, enabled, status, chats } | null, error, configured }`.

### Compatibility

Additions only, no changes; no existing data is affected.

## Drawbacks
[drawbacks]: #drawbacks

- Inbound synthesis and outbound forwarding duplicate a stretch of the messaging bridge's logic (the bridge's copy additionally carries delivery preferences, files riding along on replies, a rolling image budget, and splitting along component boundaries). This is deliberate: until a second channel's bot plugin appears, we don't guess which parts are worth making common.
- The plugin ships its own copy of Hono; the host's and the plugin's Hono versions evolve independently, and mounting across copies relies on implementation details of `route()` staying stable.

## Rationale and alternatives
[rationale-and-alternatives]: #rationale-and-alternatives

- **A `ChatBotsModule` in the platform plus a slot** (first version): the thinnest possible plugin, but it wrote a product form into the core. Rejected.
- **Change the messaging bridge and route bindings per chat**: the most reuse, but it means reworking the bridge's connection model plus the whole "enabled means bound" rule set and UI.
- **Session surfaces (PRFC-0009)**: that is about "what a Session renders"; here the Session is an ordinary conversation, only its entry point lives in chat.

## Prior art
[prior-art]: #prior-art

- This repository's session-surface plugin `claude-code`: likewise a manifest `requires`-ing one platform mechanism (`Terminals`), assembled in code.
- This repository's message binding and scheduled tasks: the connector seam, bilingual notices, attachment paths, and the create-a-Session-on-demand path.

## Unresolved questions
[unresolved-questions]: #unresolved-questions

- Whether to have a settings page in the web UI (exposing the `[discord_bot]` table as a form), along with the "contribute pages into navigation" it would depend on.
- Whether to open a Session per Discord user or per channel (when several people converse in one channel).
- When a second channel's bot plugin appears, which of the logic between the bridge and the plugin is worth extracting into shared helpers.

## Future possibilities
[future-possibilities]: #future-possibilities

- Bot plugins for Telegram / Lark / QQ / WeChat: the same package shape.
- Extracting inbound synthesis (the image budget, writing files to disk) and outbound splitting into platform-exported helpers shared by plugins and the bridge.

## Changes

### v1.0.0

- Added: migrated into the main repository; the body takes the current version of the draft carried by design PR [#127](https://github.com/Prism-Shadow/penguin-harness-design/pull/127), identical to the source file.
