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
 * settings store and the Projects' config files — reached through the module's `requires`;
 * everything that makes those a bot lives here: config.ts reads a Project's `[discord_bot]`
 * table, manager.ts keeps one bot per such Project in line with the files, bot.ts is the
 * bot (one Gateway connection, a Session per chat, replies relayed back, `/new`, `/approve`,
 * `/deny`, `/status`), routes.ts the read-only status route at `/api/discord-bot`.
 *
 * Configuration is the Project's config file and nothing else:
 *
 *   [discord_bot]
 *   bot_token = "…"          # the Bot page of the Discord developer portal
 *   agent = "default_agent"  # optional
 *   enabled = true           # optional
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
  ProjectConfigStore,
  Projects,
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
export { CONFIG_TABLE, DEFAULT_AGENT, botConfigOf, botIdOf } from "./config.js";
export type { BotConfig } from "./config.js";
export { DiscordBots, RECONCILE_INTERVAL_MS } from "./manager.js";
export type { BrokenBotInfo, ManagerDeps } from "./manager.js";
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
          projects: use.projects as Projects,
          configStore: use.configStore as ProjectConfigStore,
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
