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
 * Configuration is what this package declares in `package.json#penguin.configuration` and an
 * admin fills in on the System settings dialog's Plugins page: the bot token, the Project,
 * the Agent, the switch. Nothing else — no environment variable, no file to edit.
 */
import type { Plugin } from "@prismshadow/penguin-core/plugin";
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
export { DEFAULT_AGENT, PACKAGE_NAME, botConfigOf, botIdOf } from "./config.js";
export type { BotConfig } from "./config.js";
export { DiscordBots } from "./manager.js";
export type { BotsStatus, ManagerDeps } from "./manager.js";
export { ROUTES_ID, discordBotRoutes } from "./routes.js";

const plugin: Plugin = {
  modules: {
    DiscordBot: {
      async create({ use, effect }) {
        const bots = new DiscordBots({
          messaging: use.messaging as Messaging,
          runner: use.runner as MessagingTaskRunner,
          sessions: use.sessions as Sessions,
          sessionCreator: use.sessionCreator as ScheduleSessionCreator,
          sessionIndex: use.sessionIndex as SessionIndex,
          agents: use.agents as AgentIndex,
          pluginConfig: use.pluginConfig as PluginConfig,
          settings: use.settings as Settings,
          channels: use.channels as Channels,
          errors: use.errors as Errors,
          paths: use.paths as Paths,
          log: use.log as Log,
        });
        await bots.start();
        effect(() => bots.stop());
        return { api: {}, bind: { [ROUTES_ID]: discordBotRoutes(bots) } };
      },
    },
  },
};

export default plugin;
