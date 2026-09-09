/**
 * @prismshadow/penguin-plugin-discord-bot — a Discord bot that starts agents from chat.
 *
 * A PLUGIN PACKAGE, not part of the harness: a Project lists it in its config and the
 * harness resolves it from the installation (see the server's plugin/loader.ts). It compiles
 * against the type-only `@prismshadow/penguin-core/plugin` and
 * `@prismshadow/penguin-server/plugin` surfaces; at runtime it imports the SDK the host
 * already has (`@prismshadow/penguin-core`, external in the bundle) and bundles its own
 * copy of Hono for the status route.
 *
 * The harness has no notion of a chat bot. What it lends this package is what it already
 * has — the Discord messaging connector (credential shape, Gateway, sends, Markdown, the
 * 2000-character cap), Session creation, the task runner, the Session event channel, the
 * settings store and the plugin configuration it stores for this package — reached through
 * the module's `requires`; everything that makes those a bot lives here: config.ts reads the
 * package's options, manager.ts keeps the bot in line with them, bot.ts is the bot (one
 * Gateway connection, a Session per chat, replies relayed back, `/new`, `/approve`, `/deny`,
 * `/status`), routes.ts the read-only status route at `/api/discord-bot`.
 *
 * Configuration is the settings group the module declares below and an admin fills in on the
 * Settings dialog's Plugins page: the bot token, the Project, the Agent, the switch. Nothing
 * else — no environment variable, no file to edit.
 */
import type { Hono } from "hono";
import { Bind, Component, Use } from "@prismshadow/penguin-core/plugin";
import type { ClassCtx, Plugin } from "@prismshadow/penguin-core/plugin";
import type {
  AgentIndex,
  Channels,
  Errors,
  Log,
  Messaging,
  MessagingTaskRunner,
  Paths,
  PluginConfig,
  ScheduleSessionCreator,
  SessionIndex,
  Sessions,
  Settings,
} from "@prismshadow/penguin-server/plugin";
import { DiscordBots } from "./manager.js";
import { ROUTES_ID, discordBotRoutes } from "./routes.js";

export {
  DiscordBot,
  APPROVAL_NOTICE,
  NEW_NOTICE,
  NOTHING_PENDING_NOTICE,
  UNSUPPORTED_NOTICE,
  REPLY_CHUNK_CHARS,
  chatsKeyOf,
  chunkReply,
  mask,
  safeFileName,
  writeAttachment,
} from "./bot.js";
export type { BotDeps, BotInfo, BotStatus, BotTarget } from "./bot.js";
export { CONFIG_GROUP, DEFAULT_AGENT, botConfigOf, botIdOf } from "./config.js";
export type { BotConfig } from "./config.js";
export { DiscordBots } from "./manager.js";
export type { BotsStatus, ManagerDeps } from "./manager.js";
export { ROUTES_ID, discordBotRoutes } from "./routes.js";

/**
 * The plugin's one module: the bot, built over what the host lends it (each requirement
 * names the host module that provides it — a plugin has no host class to point at), and
 * its route on the HttpModule.routes slot. Its manifest is generated into ifaces.json
 * from here.
 */
@Component({
  contributes: {
    "HttpModule.routes": [
      { id: "discord-bot.routes", prefix: "/api/discord-bot", auth: "user", order: 286 },
    ],
    "PluginConfigProvider.groups": [
      {
        id: "discord-bot",
        title: "Discord bot",
        titleZh: "Discord 机器人",
        description:
          "Message the bot in Discord, and a Session opens on the chosen Agent and answers in the same channel. Create the bot in the Discord developer portal and invite it to your server; in a server channel it reads only messages that @-mention it.",
        descriptionZh:
          "在 Discord 里给机器人发消息，就会在所选 Agent 下开一个 Session 并在同一频道回复。先在 Discord 开发者后台创建机器人并邀请进服务器；在服务器频道里它只读取 @ 它的消息。",
        properties: {
          bot_token: {
            type: "secret",
            title: "Bot token",
            titleZh: "Bot Token",
            description: "From the Bot page of the Discord developer portal.",
            descriptionZh: "来自 Discord 开发者后台的 Bot 页。",
            required: true,
          },
          project: {
            type: "string",
            title: "Project",
            titleZh: "Project",
            description: "The id of the Project every chat's Session is created under.",
            descriptionZh: "每个聊天的 Session 创建在哪个 Project 下（填 Project id）。",
            placeholder: "default_project",
            required: true,
          },
          agent: {
            type: "string",
            title: "Agent",
            titleZh: "Agent",
            description: "The Agent in that Project that answers.",
            descriptionZh: "该 Project 中负责回答的 Agent。",
            default: "default_agent",
          },
          enabled: {
            type: "boolean",
            title: "Enabled",
            titleZh: "启用",
            description: "Off keeps the token and stops the bot.",
            descriptionZh: "关闭后保留 Token，停掉机器人。",
            default: true,
          },
        },
      },
    ],
  },
  context: { version: 1 },
})
export class DiscordBotPlugin {
  @Use("MessagingHubModule") private readonly messaging!: Messaging;
  @Use("SessionRuntimeModule") private readonly runner!: MessagingTaskRunner;
  @Use("SessionRuntimeModule") private readonly sessions!: Sessions;
  @Use("SessionRuntimeModule") private readonly sessionCreator!: ScheduleSessionCreator;
  @Use("SessionRuntimeModule") private readonly sessionIndex!: SessionIndex;
  @Use("ProjectsModule") private readonly agents!: AgentIndex;
  @Use("PluginConfigModule") private readonly pluginConfig!: PluginConfig;
  @Use("SettingsModule") private readonly settings!: Settings;
  @Use("RuntimeModule") private readonly channels!: Channels;
  @Use("ObservabilityModule") private readonly errors!: Errors;
  @Use("RuntimeModule") private readonly paths!: Paths;
  @Use("RuntimeModule") private readonly log!: Log;
  @Bind("discord-bot.routes") routes!: Hono;

  async setup({ effect }: ClassCtx) {
    const bots = new DiscordBots({
      messaging: this.messaging,
      runner: this.runner,
      sessions: this.sessions,
      sessionCreator: this.sessionCreator,
      sessionIndex: this.sessionIndex,
      agents: this.agents,
      pluginConfig: this.pluginConfig,
      settings: this.settings,
      channels: this.channels,
      errors: this.errors,
      paths: this.paths,
      log: this.log,
    });
    await bots.start();
    effect(() => bots.stop());
    this.routes = discordBotRoutes(bots);
  }
}

const plugin: Plugin = { modules: [DiscordBotPlugin] };

export default plugin;
